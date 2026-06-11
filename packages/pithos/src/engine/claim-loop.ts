import { Effect } from "effect";
import { sql, type Capability } from "../db.js";
import type { Db } from "../db.js";
import { fail } from "../errors.js";
import { ActiveArtifactMetadataRowSchema, decodeRow, type RunRow } from "../rows.js";
import { withCollisionGuard, withDb } from "./db-helpers.js";
import { event } from "./event-log.js";
import { createRepairAlertInTxn } from "./repair-alerts.js";
import { isClaimable, taskDetail, taskGates, taskSummary } from "./task-read-model.js";
import type { Engine, EngineContext } from "./types.js";

export interface ClaimLoopDeps {
	readonly requireNonEmpty: (value: string, name: string) => string;
	readonly resolveRunId: (ctx: EngineContext, explicit: string | undefined) => string;
	readonly liveRun: (db: Db, runId: string) => RunRow;
	readonly authorized: (
		db: Db,
		table: "agent_claims" | "agent_enqueues",
		runId: string,
		cap: Capability,
	) => RunRow;
	readonly enforceCapScope: (db: Db, scopeId: string, cap: Capability) => void;
}

const queuedTaskQuery = sql`
SELECT id
FROM tasks t
WHERE t.status = 'queued'
  AND t.scope_id = ?
  AND t.capability = ?
ORDER BY t.created_at ASC, t.id ASC
`;

const claimRunTaskUpdate = sql`
UPDATE runs
SET task_id = ?,
    has_claimed_task = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?
  AND task_id IS NULL
`;

const claimTaskUpdate = sql`
UPDATE tasks
SET status = 'claimed',
    attempts = attempts + 1,
    claim_sequence = claim_sequence + 1,
    fencing_token = fencing_token + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?
  AND status = 'queued'
RETURNING id, fencing_token, attempts, claim_sequence, capability
`;

const artifactKindPattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

type ArtifactAddOutput = ReturnType<Engine["artifactAdd"]>["artifact"];

const parseArtifactAddOutput = (value: unknown): ArtifactAddOutput =>
	decodeRow(ActiveArtifactMetadataRowSchema, value, "artifact add output");

const requireArtifactKind = (kind: string): string => {
	if (!artifactKindPattern.test(kind)) {
		fail("VALIDATION_ERROR", "--kind must be lower snake case");
	}
	return kind;
};

export const makeClaimLoopOps = (
	ctx: EngineContext,
	deps: ClaimLoopDeps,
): Pick<Engine, "claim" | "heartbeat" | "complete" | "failTask" | "artifactAdd" | "cancel"> => ({
	claim: ({ runId, scope, capability }) =>
		withDb(ctx, (db) => {
			const actorRunId = deps.resolveRunId(ctx, runId);
			deps.enforceCapScope(db, scope, capability);
			const r = deps.authorized(db, "agent_claims", actorRunId, capability);
			if (r.scope_id !== scope)
				fail("VALIDATION_ERROR", `claim scope ${scope} does not match run scope ${r.scope_id}`);

			const claimed = db.transaction(() => {
				const currentRun = deps.liveRun(db, actorRunId);
				if (currentRun.task_id !== null) fail("VALIDATION_ERROR", "run already holds a task");

				const candidates = db.prepare(queuedTaskQuery).all(scope, capability) as { id: string }[];
				const candidate = candidates.find((row) =>
					isClaimable(db, { id: row.id, status: "queued" }),
				);
				const task = candidate ?? fail("NO_CLAIMABLE_WORK", "no claimable work");

				const runRow = db.prepare(claimRunTaskUpdate).run(task.id, actorRunId);
				if (runRow.changes === 0) fail("VALIDATION_ERROR", "run already holds a task");

				const updated = db.prepare(claimTaskUpdate).get(task.id) as
					| {
							readonly id: string;
							readonly fencing_token: number;
							readonly attempts: number;
							readonly claim_sequence: number;
							readonly capability: Capability;
					  }
					| undefined;

				const claimedTask =
					updated ?? fail("STALE_TOKEN_RACE", "claim candidate changed before update");
				for (const gate of taskGates(db, claimedTask.id)) {
					db.prepare(sql`
						INSERT INTO task_gate_releases(task_id,target_task_id,claim_sequence,attempt,fencing_token,released_by_run_id)
						VALUES (?,?,?,?,?,?)
					`).run(
						claimedTask.id,
						gate.target_task_id,
						claimedTask.claim_sequence,
						claimedTask.attempts,
						claimedTask.fencing_token,
						actorRunId,
					);
					for (const member of gate.members) {
						db.prepare(sql`
							INSERT INTO task_gate_release_members(task_id,target_task_id,claim_sequence,member_task_id,canonical_task_id,status_at_release)
							VALUES (?,?,?,?,?,?)
						`).run(
							claimedTask.id,
							gate.target_task_id,
							claimedTask.claim_sequence,
							member.task_id,
							member.canonical_task_id,
							member.status,
						);
					}
					event(ctx, db, "task.gate_released", {
						task_id: claimedTask.id,
						actor_run_id: actorRunId,
						payload: {
							target_task_id: gate.target_task_id,
							claim_sequence: claimedTask.claim_sequence,
							attempt: claimedTask.attempts,
							fencing_token: claimedTask.fencing_token,
							release_run_id: actorRunId,
							release_member_task_ids: gate.members.map((member) => member.task_id),
						},
					});
				}
				event(ctx, db, "task.claimed", {
					task_id: claimedTask.id,
					actor_run_id: actorRunId,
					payload: { run_id: actorRunId, fencing_token: claimedTask.fencing_token },
				});
				return claimedTask;
			})();

			return {
				ok: true,
				task: {
					id: claimed.id,
					status: "claimed",
					token: claimed.fencing_token,
					capability: claimed.capability,
				},
			};
		}),
	heartbeat: ({ runId, taskId, token }) =>
		withDb(ctx, (db) => {
			const actorRunId = deps.resolveRunId(ctx, runId);
			if ((taskId === undefined) !== (token === undefined)) {
				fail("VALIDATION_ERROR", "--task and --token must be supplied together");
			}
			const run = deps.liveRun(db, actorRunId);
			if (taskId === undefined) {
				event(ctx, db, "run.heartbeat", { run_id: actorRunId, payload: { status: run.status } });
				return { ok: true, status: run.status };
			}
			const heartbeatToken = token ?? fail("VALIDATION_ERROR", "missing --token");
			db.transaction(() => {
				const previous = db
					.prepare(sql`
					SELECT status
					FROM tasks
					WHERE id = ?
					  AND fencing_token = ?
					  AND status IN ('claimed','running')
					  AND EXISTS (SELECT 1 FROM runs WHERE id = ? AND task_id = tasks.id)
				`)
					.get(taskId, heartbeatToken, actorRunId) as { status: string } | undefined;
				const previousRow =
					previous ?? fail("STALE_TOKEN", "heartbeat token is stale or task is not held by run");
				const previousStatus = previousRow.status;
				db.prepare(sql`
					UPDATE tasks
					SET status = CASE status WHEN 'claimed' THEN 'running' ELSE status END,
					    updated_at = CURRENT_TIMESTAMP
					WHERE id = ?
				`).run(taskId);
				event(ctx, db, "task.heartbeat", {
					task_id: taskId,
					actor_run_id: actorRunId,
					payload: {
						run_id: actorRunId,
						fencing_token: heartbeatToken,
						previous_status: previousStatus,
						status: "running",
					},
				});
			})();
			return { ok: true, status: "running" };
		}),
	complete: ({ taskId, runId, token, resultJson }) =>
		withDb(ctx, (db) => {
			const actorRunId = deps.resolveRunId(ctx, runId);
			deps.liveRun(db, actorRunId);
			db.transaction(() => {
				const result = db
					.prepare(sql`
					UPDATE tasks
					SET status='done', result_json=?, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
					WHERE id=? AND fencing_token=? AND status IN ('claimed','running')
					  AND EXISTS (SELECT 1 FROM runs WHERE id=? AND task_id=tasks.id)
				`)
					.run(resultJson, taskId, token, actorRunId);
				if (result.changes === 0)
					fail("STALE_TOKEN", "complete token is stale or task is not held by run");
				db.prepare(
					sql`UPDATE runs SET task_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND task_id=?`,
				).run(actorRunId, taskId);
				event(ctx, db, "task.completed", {
					task_id: taskId,
					actor_run_id: actorRunId,
					payload: { run_id: actorRunId, fencing_token: token },
				});
			})();
			return { ok: true, task: { id: taskId, status: "done" } };
		}),
	failTask: ({ taskId, runId, token, reason }) =>
		withDb(ctx, (db) => {
			const actorRunId = deps.resolveRunId(ctx, runId);
			deps.liveRun(db, actorRunId);
			const nonEmptyReason = deps.requireNonEmpty(reason, "--reason");
			db.transaction(() => {
				const affectedTask = taskDetail(db, taskId);
				const result = db
					.prepare(sql`
					UPDATE tasks
					SET status='failed', result_json=?, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
					WHERE id=? AND fencing_token=? AND status IN ('claimed','running')
					  AND EXISTS (SELECT 1 FROM runs WHERE id=? AND task_id=tasks.id)
				`)
					.run(JSON.stringify({ reason: nonEmptyReason }), taskId, token, actorRunId);
				if (result.changes === 0)
					fail("STALE_TOKEN", "fail token is stale or task is not held by run");
				db.prepare(
					sql`UPDATE runs SET task_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND task_id=?`,
				).run(actorRunId, taskId);
				event(ctx, db, "task.failed", {
					task_id: taskId,
					actor_run_id: actorRunId,
					payload: { run_id: actorRunId, fencing_token: token, reason: nonEmptyReason },
				});
				createRepairAlertInTxn(ctx, db, {
					kind: "task_failed",
					affectedTaskId: taskId,
					escalationTitle: `Investigate failed task ${taskId}`,
					escalationBody: `Task ${taskId} failed while held by run ${actorRunId} (scope: ${affectedTask.scope_id}, capability: ${affectedTask.capability}, attempts: ${affectedTask.attempts}).\n\nReason: ${nonEmptyReason}\n\nInvestigate the task and decide whether to replay it after fixing context/preconditions, supersede it if the work definition changed, replan, or accept the failure.`,
				});
			})();
			return { ok: true, task: { id: taskId, status: "failed" } };
		}),
	artifactAdd: ({ taskId, runId, token, kind, title, body }) =>
		withDb(ctx, (db) => {
			const actorRunId = deps.resolveRunId(ctx, runId);
			deps.liveRun(db, actorRunId);
			const artifactKind = requireArtifactKind(deps.requireNonEmpty(kind, "--kind"));
			const artifactTitle = deps.requireNonEmpty(title, "--title");
			const artifactId = Effect.runSync(ctx.services.ids.make("artifact"));
			const artifactResult = withCollisionGuard(artifactId, () =>
				db.transaction((): ArtifactAddOutput => {
					const inserted = db
						.prepare(sql`
							INSERT INTO artifacts(id,task_id,run_id,kind,title,body,status)
							SELECT ?, t.id, ?, ?, ?, ?, 'active'
							FROM tasks t
							WHERE t.id = ?
							  AND t.status IN ('claimed','running')
							  AND t.fencing_token = ?
							  AND EXISTS (
								  SELECT 1
								  FROM runs r
								  WHERE r.id = ?
								    AND r.status = 'live'
								    AND r.task_id = t.id
							  )
							RETURNING id, task_id, run_id, kind, title, status, created_at
						`)
						.get(
							artifactId,
							actorRunId,
							artifactKind,
							artifactTitle,
							body,
							taskId,
							token,
							actorRunId,
						) as ArtifactAddOutput | undefined;
					if (inserted === undefined) {
						const task = db.prepare(sql`SELECT status FROM tasks WHERE id=?`).get(taskId) as
							| { readonly status: string }
							| undefined;
						const status: string = task?.status ?? fail("NOT_FOUND", `task not found: ${taskId}`);
						if (!["claimed", "running"].includes(status)) {
							fail("VALIDATION_ERROR", `task status cannot receive artifacts: ${status}`);
						}
						fail("STALE_TOKEN", "artifact add token is stale or task is not held by run");
					}
					event(ctx, db, "task.artifact_added", {
						task_id: taskId,
						actor_run_id: actorRunId,
						payload: { artifact_id: artifactId, kind: artifactKind },
					});
					return parseArtifactAddOutput(inserted);
				})(),
			);
			const artifact: ArtifactAddOutput =
				artifactResult ?? fail("ID_COLLISION", `artifact id collision: ${artifactId}`);
			return { ok: true, artifact };
		}),
	cancel: ({ taskId, runId, reason }) =>
		withDb(ctx, (db) => {
			const actorRunId = deps.resolveRunId(ctx, runId);
			deps.liveRun(db, actorRunId);
			const nonEmptyReason = deps.requireNonEmpty(reason, "--reason");
			db.transaction(() => {
				const task = taskSummary(db, taskId);
				if (["claimed", "running"].includes(task.status)) {
					fail(
						"VALIDATION_ERROR",
						`task ${taskId} is ${task.status}; use pdx kill or pithos run interrupt for held tasks`,
					);
				}
				if (!["queued", "failed", "dead_letter"].includes(task.status)) {
					fail("VALIDATION_ERROR", `task status cannot be cancelled: ${task.status}`);
				}
				const result = db
					.prepare(
						sql`UPDATE tasks SET status='cancelled', completed_at=COALESCE(completed_at, CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=?`,
					)
					.run(taskId, task.status);
				if (result.changes === 0) fail("STALE_TOKEN_RACE", "task changed before cancel");
				event(ctx, db, "task.cancelled", {
					task_id: taskId,
					actor_run_id: actorRunId,
					payload: { reason: nonEmptyReason },
				});
			})();
			return { ok: true, task: { id: taskId, status: "cancelled" } };
		}),
});
