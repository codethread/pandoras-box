import { loadConfiguredArtifactContractSync } from "../artifact-contracts.js";
import { sql } from "../db.js";
import { fail } from "../errors.js";
import { decodeRow, RepairAlertKindSchema, type RepairAlertKind } from "../rows.js";
import { withDb } from "./db-helpers.js";
import { inspectGraph } from "./graph-inspect.js";
import {
	artifactList,
	artifactShow,
	isClaimable,
	parseTaskDetail,
	parseTaskSummary,
	taskArtifacts,
	taskAttachedContext,
	taskGateLateGrowthMarkers,
	taskGates,
	taskInspectTask,
	taskLineage,
	taskSourceSummary,
	taskSummary,
	taskSummarySelect,
	taskSupersessionLinks,
	unresolvedDependencies,
} from "./task-read-model.js";
import type { Engine, EngineContext } from "./types.js";

export const makeInspectOps = (
	ctx: EngineContext,
): Pick<Engine, "artifactList" | "artifactShow" | "taskInspect" | "graphInspect" | "briefing"> => ({
	artifactList: ({ taskId }) =>
		withDb(ctx, (db) => ({ ok: true, artifacts: artifactList(db, taskId) })),
	artifactShow: ({ artifactId }) =>
		withDb(ctx, (db) => ({ ok: true, artifact: artifactShow(db, artifactId) })),
	taskInspect: ({ taskId }) =>
		withDb(ctx, (db) => {
			const task = taskInspectTask(db, taskId);
			const dependencies = db
				.prepare(
					`${taskSummarySelect} WHERE t.id IN (SELECT target_task_id FROM task_edges WHERE task_id=? AND kind='after') ORDER BY t.created_at ASC, t.id ASC`,
				)
				.all(taskId)
				.map((row) => parseTaskDetail(row, "malformed dependency task row"));
			const dependents = db
				.prepare(
					`${taskSummarySelect} WHERE t.id IN (SELECT task_id FROM task_edges WHERE target_task_id=? AND kind='after') ORDER BY t.created_at ASC, t.id ASC`,
				)
				.all(taskId)
				.map((row) => parseTaskDetail(row, "malformed dependent task row"));
			const { supersedes, superseded_by } = taskSupersessionLinks(db, taskId);
			const repairAlertRow = db
				.prepare(sql`SELECT kind FROM repair_alerts WHERE task_id=?`)
				.get(taskId) as { kind: string } | undefined;
			const repairAlertKind: RepairAlertKind | null =
				repairAlertRow !== undefined
					? decodeRow(
							RepairAlertKindSchema,
							repairAlertRow.kind,
							`repair_alerts.kind for task ${taskId}`,
						)
					: null;
			return {
				ok: true,
				task,
				dependencies,
				dependents,
				source: taskSourceSummary(db, taskId),
				attached_context: taskAttachedContext(db, taskId),
				lineage: taskLineage(db, taskId),
				supersedes,
				superseded_by,
				artifacts: taskArtifacts(db, taskId),
				repair_alert_kind: repairAlertKind,
				late_growth_markers: taskGateLateGrowthMarkers(db).filter(
					(marker) =>
						marker.gate_task_id === taskId ||
						marker.gate_target_task_id === taskId ||
						(marker.mutation_kind === "edge_inserted" &&
							(marker.edge_task_id === taskId || marker.edge_target_task_id === taskId)) ||
						(marker.mutation_kind === "supersession" &&
							(marker.superseded_task_id === taskId || marker.replacement_task_id === taskId)),
				),
			};
		}),
	graphInspect: ({ taskId, scope, all, status = [], search = [], sinceCutoff }) =>
		withDb(ctx, (db) =>
			inspectGraph(db, {
				taskId,
				scope,
				all,
				status,
				search,
				sinceCutoff,
				contract: loadConfiguredArtifactContractSync(ctx.config, ctx.services.fs),
			}),
		),
	briefing: ({ agent }) =>
		withDb(ctx, (db) => {
			const caps =
				agent === undefined
					? undefined
					: (
							db
								.prepare(sql`SELECT capability FROM agent_claims WHERE agent_kind=?`)
								.all(agent) as { capability: string }[]
						).map((r) => r.capability);
			if (agent !== undefined && caps?.length === 0)
				fail("VALIDATION_ERROR", `unknown or unclaiming agent: ${agent}`);
			const queued = db
				.prepare(`${taskSummarySelect} WHERE t.status='queued' ORDER BY t.created_at ASC, t.id ASC`)
				.all()
				.map((row) => parseTaskSummary(row, "malformed queued task row"));
			const visible =
				caps === undefined ? queued : queued.filter((t) => caps.includes(t.capability));
			const recentlyCompleted = db
				.prepare(
					`${taskSummarySelect} WHERE t.status='done' AND t.completed_at > datetime('now', '-1 hour') ORDER BY t.completed_at DESC`,
				)
				.all()
				.map((row) => parseTaskSummary(row, "malformed recently completed task row"));
			return {
				ok: true,
				ready: visible.filter((t) => isClaimable(db, t)),
				blocked: visible
					.filter((t) => !isClaimable(db, t))
					.map((t) => {
						const blockers = unresolvedDependencies(db, t.id).map((id) => {
							const blocker = taskSummary(db, id);
							return {
								id: blocker.id,
								scope_id: blocker.scope_id,
								status: blocker.status,
								scope_description: blocker.scope_description,
							};
						});
						return {
							...t,
							unresolved_dependency_ids: blockers.map((b) => b.id),
							blockers,
							gates: taskGates(db, t.id).filter((gate) => gate.state !== "clear"),
						};
					}),
				recentlyCompleted,
			};
		}),
});
