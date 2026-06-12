import { Effect } from "effect";
import { finalDependencyIds, resolveChainPolicy } from "../chain-policy.js";
import { sql } from "../db.js";
import { fail } from "../errors.js";
import { withCollisionGuard, withDb } from "./db-helpers.js";
import { event } from "./event-log.js";
import { assertGraphIntegrity } from "./graph-integrity.js";
import {
	authorized,
	enforceTaskAdmissionScope,
	liveRun,
	requireNonEmpty,
	resolveBody,
	resolveRunId,
} from "./guards.js";
import { enforceReleasedGateLateGrowth } from "./late-growth.js";
import {
	insertTaskEdge,
	insertTaskSource,
	taskDetail,
	taskSourceEdge,
	taskSummary,
	type TaskSummary,
	validateReferenceTaskCurrent,
} from "./task-read-model.js";
import type { ChainOutput, Engine, EngineContext, ReplayOutput } from "./types.js";

export const makeTaskMutationOps = (
	ctx: EngineContext,
): Pick<Engine, "enqueue" | "replay" | "supersede"> => ({
	enqueue: ({
		scope,
		capability,
		title,
		body,
		bodyFile,
		runId,
		after,
		gate = [],
		about,
		repair,
		chain,
	}) =>
		withDb(ctx, (db) => {
			const actorRunId = resolveRunId(ctx, runId);
			const actorRun = authorized(db, "agent_enqueues", actorRunId, capability);
			enforceTaskAdmissionScope(ctx, db, scope, capability);
			const uniqueAfter = new Set(after);
			if (uniqueAfter.size !== after.length) fail("VALIDATION_ERROR", "duplicate --after task id");
			const uniqueGate = new Set(gate);
			if (uniqueGate.size !== gate.length) fail("VALIDATION_ERROR", "duplicate --gate-on task id");
			if (about !== undefined && repair !== undefined) {
				fail("VALIDATION_ERROR", "provide only one of --about or --repair");
			}
			if (repair !== undefined && actorRun.agent_kind !== "pdx") {
				fail("VALIDATION_ERROR", "--repair edges must be authored by pdx");
			}
			const taskBody = resolveBody(ctx, body, bodyFile);
			const taskTitle = requireNonEmpty(title, "--title");
			const taskId = Effect.runSync(ctx.services.ids.make("task"));

			const chainOutput = withCollisionGuard(taskId, () =>
				db.transaction((): ChainOutput => {
					const currentActorRun = liveRun(db, actorRunId);
					const heldTask =
						currentActorRun.task_id === null ? null : taskSummary(db, currentActorRun.task_id);
					const heldSource =
						currentActorRun.task_id === null ? null : taskSourceEdge(db, currentActorRun.task_id);
					const heldGateTarget =
						currentActorRun.task_id === null
							? undefined
							: (db
									.prepare(
										sql`SELECT target_task_id FROM task_edges WHERE task_id=? AND kind='gate' ORDER BY created_at ASC, target_task_id ASC LIMIT 1`,
									)
									.pluck()
									.get(currentActorRun.task_id) as string | undefined);
					const decision = resolveChainPolicy({
						policy: chain,
						newTaskCapability: capability,
						heldTask,
						heldSource:
							heldSource !== null
								? {
										taskId: heldSource.source_task_id,
										kind: heldSource.kind === "about" ? "chain_source" : "repair_source",
									}
								: heldGateTarget === undefined
									? null
									: { taskId: heldGateTarget, kind: "chain_source" },
					});
					const dependencyIds = finalDependencyIds({
						manualDependencyIds: after,
						implicitDependencyIds: decision.implicitDependencyIds,
					});
					const aboutIds = [
						about,
						decision.applied === "source_from_held" ? decision.sourceTaskId : null,
					].filter((id): id is string => id !== undefined && id !== null);
					if (aboutIds.length > 1) fail("VALIDATION_ERROR", "about edge is singular per task");
					const repairIds = repair === undefined ? [] : [repair];
					const output: ChainOutput = {
						policy: decision.policy,
						applied: decision.applied,
						held_task_id: decision.heldTaskId,
						source_task_id: decision.sourceTaskId,
						source_kind: decision.sourceKind,
						implicit_dependency_ids: decision.implicitDependencyIds,
						final_dependency_ids: dependencyIds,
					};
					for (const depId of dependencyIds) validateReferenceTaskCurrent(db, depId, "after");
					for (const gateId of gate) validateReferenceTaskCurrent(db, gateId, "gate");
					for (const aboutId of aboutIds) validateReferenceTaskCurrent(db, aboutId, "about");
					for (const repairId of repairIds) validateReferenceTaskCurrent(db, repairId, "repair");
					db.prepare(
						sql`INSERT INTO tasks(id,scope_id,capability,title,body,created_by_run_id) VALUES (?,?,?,?,?,?)`,
					).run(taskId, scope, capability, taskTitle, taskBody, actorRunId);
					for (const depId of dependencyIds) {
						insertTaskEdge(db, taskId, depId, actorRunId, "after");
					}
					for (const gateId of gate) {
						insertTaskEdge(db, taskId, gateId, actorRunId, "gate");
					}
					for (const aboutId of aboutIds) {
						insertTaskSource(db, taskId, aboutId, actorRunId, "chain_source");
					}
					for (const repairId of repairIds) {
						insertTaskSource(db, taskId, repairId, actorRunId, "repair_source");
					}
					assertGraphIntegrity(db);
					for (const edge of [
						...dependencyIds.map((targetId) => ({ targetId, kind: "after" as const })),
						...aboutIds.map((targetId) => ({ targetId, kind: "about" as const })),
						...repairIds.map((targetId) => ({ targetId, kind: "repair" as const })),
					]) {
						enforceReleasedGateLateGrowth(ctx, db, actorRunId, edge.targetId, {
							kind: "edge_inserted",
							edgeTaskId: taskId,
							edgeTargetTaskId: edge.targetId,
							edgeKind: edge.kind,
						});
					}
					event(ctx, db, "task.created", {
						task_id: taskId,
						actor_run_id: actorRunId,
						payload: {
							scope_id: scope,
							capability,
							title: taskTitle,
							edges: {
								after: dependencyIds,
								about: aboutIds,
								repair: repairIds,
								gate,
							},
							chain: {
								policy: output.policy,
								applied: output.applied,
								held_task_id: output.held_task_id,
								source_task_id: output.source_task_id,
								source_kind: output.source_kind,
								implicit_dependency_ids: output.implicit_dependency_ids,
								final_dependency_ids: output.final_dependency_ids,
							},
						},
					});
					return output;
				})(),
			);
			return { ok: true, task: { id: taskId, status: "queued" }, chain: chainOutput };
		}),
	replay: ({ taskId, runId, token, reason }) =>
		withDb(ctx, (db) => {
			const actorRunId = resolveRunId(ctx, runId);
			const nonEmptyReason = requireNonEmpty(reason, "--reason");
			return db.transaction((): ReplayOutput => {
				const actorRun = liveRun(db, actorRunId);
				if (actorRun.agent_kind !== "pandora") {
					fail("VALIDATION_ERROR", "task replay must be performed by pandora");
				}
				const repairAlertTaskId =
					actorRun.task_id ?? fail("VALIDATION_ERROR", "pandora run does not hold a Repair Alert");
				const repairAlertTask = taskDetail(db, repairAlertTaskId);
				if (repairAlertTask.fencing_token !== token) {
					fail("STALE_TOKEN", "repair alert token is stale or task is not held by run");
				}
				if (repairAlertTask.capability !== "escalate") {
					fail("VALIDATION_ERROR", "held task is not an escalation Repair Alert");
				}
				if (repairAlertTask.status !== "claimed" && repairAlertTask.status !== "running") {
					fail("VALIDATION_ERROR", `held Repair Alert is not active: ${repairAlertTask.status}`);
				}
				if (
					db.prepare(sql`SELECT 1 FROM repair_alerts WHERE task_id=?`).get(repairAlertTaskId) ===
					undefined
				) {
					fail("VALIDATION_ERROR", "held escalation is not a Repair Alert");
				}
				const target = taskDetail(db, taskId);
				if (
					db
						.prepare(
							sql`SELECT 1 FROM task_edges WHERE task_id=? AND target_task_id=? AND kind='repair'`,
						)
						.get(repairAlertTaskId, taskId) === undefined
				) {
					fail("VALIDATION_ERROR", "held Repair Alert does not repair the target task");
				}
				if (
					db.prepare(sql`SELECT 1 FROM task_supersessions WHERE old_task_id=?`).get(taskId) !==
					undefined
				) {
					fail("VALIDATION_ERROR", "task has already been superseded");
				}
				if (!["failed", "dead_letter", "cancelled"].includes(target.status)) {
					fail("VALIDATION_ERROR", `task status cannot be replayed: ${target.status}`);
				}
				enforceTaskAdmissionScope(ctx, db, target.scope_id, target.capability);
				const replayUpdate = db
					.prepare(sql`
						UPDATE tasks
						SET status='queued',
						    attempts=0,
						    result_json='{}',
						    completed_at=NULL,
						    fencing_token=fencing_token + 1,
						    updated_at=CURRENT_TIMESTAMP
						WHERE id=?
						  AND status=?
						  AND fencing_token=?
					`)
					.run(taskId, target.status, target.fencing_token);
				if (replayUpdate.changes === 0) {
					fail("STALE_TOKEN_RACE", "replay target changed before update");
				}
				const completionResult = JSON.stringify({
					resolution: "replayed",
					target_task_id: taskId,
					reason: nonEmptyReason,
				});
				const alertUpdate = db
					.prepare(sql`
						UPDATE tasks
						SET status='done',
						    result_json=?,
						    completed_at=CURRENT_TIMESTAMP,
						    updated_at=CURRENT_TIMESTAMP
						WHERE id=?
						  AND fencing_token=?
						  AND status IN ('claimed','running')
					`)
					.run(completionResult, repairAlertTaskId, token);
				if (alertUpdate.changes === 0) {
					fail("STALE_TOKEN", "repair alert token is stale or task is not held by run");
				}
				const runUpdate = db
					.prepare(sql`
						UPDATE runs
						SET task_id=NULL,
						    updated_at=CURRENT_TIMESTAMP
						WHERE id=? AND task_id=?
					`)
					.run(actorRunId, repairAlertTaskId);
				if (runUpdate.changes === 0) {
					fail("STALE_TOKEN_RACE", "repair alert holder changed before update");
				}
				event(ctx, db, "task.replayed", {
					task_id: taskId,
					actor_run_id: actorRunId,
					payload: {
						reason: nonEmptyReason,
						repair_alert_task_id: repairAlertTaskId,
						previous_status: target.status,
						previous_attempts: target.attempts,
						previous_fencing_token: target.fencing_token,
						new_fencing_token: target.fencing_token + 1,
					},
				});
				event(ctx, db, "task.completed", {
					task_id: repairAlertTaskId,
					actor_run_id: actorRunId,
					payload: {
						run_id: actorRunId,
						fencing_token: token,
						resolution: "replayed",
						target_task_id: taskId,
						reason: nonEmptyReason,
					},
				});
				return {
					ok: true as const,
					task: { id: taskId, status: "queued" as const },
					repair_alert: { id: repairAlertTaskId, status: "done" as const },
				};
			})();
		}),
	supersede: ({ taskId, runId, reason, title, body, bodyFile, scope, capability }) =>
		withDb(ctx, (db) => {
			const actorRunId = resolveRunId(ctx, runId);
			liveRun(db, actorRunId);
			const nonEmptyReason = requireNonEmpty(reason, "--reason");
			const replacementId = Effect.runSync(ctx.services.ids.make("task"));
			const old =
				(db.prepare(sql`SELECT * FROM tasks WHERE id=?`).get(taskId) as
					| (TaskSummary & { body: string; max_attempts: number })
					| undefined) ?? fail("NOT_FOUND", `task not found: ${taskId}`);
			if (!["queued", "failed", "dead_letter", "cancelled"].includes(old.status)) {
				fail("VALIDATION_ERROR", `task status cannot be superseded: ${old.status}`);
			}
			const replacementScope = scope ?? old.scope_id;
			const replacementCap = capability ?? old.capability;
			authorized(db, "agent_enqueues", actorRunId, replacementCap);
			enforceTaskAdmissionScope(ctx, db, replacementScope, replacementCap);
			const replacementBody =
				body === undefined && bodyFile === undefined ? old.body : resolveBody(ctx, body, bodyFile);
			const replacementTitle = title ?? old.title;
			return withCollisionGuard(replacementId, () =>
				db.transaction(() => {
					if (
						db.prepare(sql`SELECT 1 FROM task_supersessions WHERE old_task_id=?`).get(taskId) !==
						undefined
					)
						fail("VALIDATION_ERROR", "task has already been superseded");
					const dependents = db
						.prepare(
							sql`SELECT t.id, t.status FROM tasks t JOIN task_edges td ON td.task_id=t.id WHERE td.target_task_id=? AND td.kind IN ('after','gate')`,
						)
						.all(taskId) as { id: string; status: string }[];
					const retargeted = dependents.filter((d) => d.status === "queued").map((d) => d.id);
					const invalid = dependents.find((d) => d.status !== "queued" && d.status !== "cancelled");
					if (invalid !== undefined)
						fail("VALIDATION_ERROR", `dependent task is not queued: ${invalid.id}`);
					if (replacementScope !== old.scope_id && retargeted.length > 0)
						fail("VALIDATION_ERROR", "cannot change scope while retargeting queued dependents");
					db.prepare(
						sql`INSERT INTO tasks(id,scope_id,capability,title,body,max_attempts,created_by_run_id) VALUES (?,?,?,?,?,?,?)`,
					).run(
						replacementId,
						replacementScope,
						replacementCap,
						replacementTitle,
						replacementBody,
						old.max_attempts,
						actorRunId,
					);
					const copiedBlockingEdges = db
						.prepare(
							sql`SELECT target_task_id AS id, kind FROM task_edges WHERE task_id=? AND kind IN ('after','gate')`,
						)
						.all(taskId) as { id: string; kind: "after" | "gate" }[];
					for (const edge of copiedBlockingEdges)
						db.prepare(
							sql`INSERT INTO task_edges(task_id,target_task_id,kind,created_by_run_id) VALUES (?,?,?,?)`,
						).run(replacementId, edge.id, edge.kind, actorRunId);
					for (const id of retargeted)
						db.prepare(
							sql`UPDATE task_edges SET target_task_id=? WHERE task_id=? AND target_task_id=? AND kind IN ('after','gate')`,
						).run(replacementId, id, taskId);
					enforceReleasedGateLateGrowth(ctx, db, actorRunId, taskId, {
						kind: "supersession",
						supersededTaskId: taskId,
						replacementTaskId: replacementId,
					});
					db.prepare(
						sql`INSERT INTO task_supersessions(old_task_id,new_task_id,created_by_run_id,reason) VALUES (?,?,?,?)`,
					).run(taskId, replacementId, actorRunId, nonEmptyReason);
					if (old.status === "queued") {
						db.prepare(
							sql`UPDATE tasks SET status='cancelled', completed_at=COALESCE(completed_at, CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP WHERE id=?`,
						).run(taskId);
						event(ctx, db, "task.cancelled", {
							task_id: taskId,
							actor_run_id: actorRunId,
							payload: { reason: nonEmptyReason, superseded_by_task_id: replacementId },
						});
					}
					event(ctx, db, "task.created", {
						task_id: replacementId,
						actor_run_id: actorRunId,
						payload: {
							scope_id: replacementScope,
							capability: replacementCap,
							title: replacementTitle,
							edges: {
								after: copiedBlockingEdges
									.filter((edge) => edge.kind === "after")
									.map((edge) => edge.id),
								about: [],
								repair: [],
								gate: copiedBlockingEdges
									.filter((edge) => edge.kind === "gate")
									.map((edge) => edge.id),
							},
							supersedes_task_id: taskId,
						},
					});
					event(ctx, db, "task.superseded", {
						task_id: taskId,
						actor_run_id: actorRunId,
						payload: {
							new_task_id: replacementId,
							reason: nonEmptyReason,
							retargeted_dependent_task_ids: retargeted,
						},
					});
					assertGraphIntegrity(db);
					return {
						ok: true as const,
						task: {
							id: replacementId,
							status: "queued" as const,
							scope_id: replacementScope,
							capability: replacementCap,
						},
						supersession: {
							old_task_id: taskId,
							new_task_id: replacementId,
							retargeted_dependent_task_ids: retargeted,
						},
					};
				})(),
			);
		}),
});
