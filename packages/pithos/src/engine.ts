import { Effect } from "effect";
import { migrate, openDb } from "./db.js";
import { makeClaimLoopOps } from "./engine/claim-loop.js";
import { eventsTail, pruneEvents } from "./engine/event-log.js";
import { makeInspectOps } from "./engine/inspect-ops.js";
import { makeRepairAlertOps } from "./engine/repair-alerts.js";
import { makeRunLifecycleOps } from "./engine/run-lifecycle.js";
import { makeScopeOps } from "./engine/scopes.js";
import { makeTaskAdmissionOps } from "./engine/task-admission.js";
import type { Engine, EngineContext } from "./engine/types.js";

export { parseGraphSinceCutoff } from "./engine/graph-inspect.js";
export {
	renderArtifactListText,
	renderArtifactShowText,
	renderBriefingText,
	renderGraphInspectText,
	renderTaskInspectMarkdown,
} from "./engine/render.js";
export { PDX_SYSTEM_RUN_ID } from "./engine/types.js";
export type {
	ArtifactDetailOutput,
	ArtifactMetadataOutput,
	ArtifactOutput,
	BlockerOutput,
	BlockedTaskOutput,
	BriefingOutput,
	ChainOutput,
	Engine,
	EngineContext,
	EnqueueOutput,
	EventOutput,
	GraphEdgeOutput,
	GraphInspectOutput,
	GraphNodeOutput,
	GraphSelectorOutput,
	GraphSinceCutoff,
	Json,
	LaunchPreconditionEscalationOutput,
	LineageEntryOutput,
	RepairAlertOutput,
	ReplayOutput,
	RunOutput,
	ScopeIdentityOutput,
	ScopeOutput,
	SupersedeOutput,
	TaskDetailOutput,
	TaskInspectOutput,
	TaskInspectTaskOutput,
	TaskSourceSummaryOutput,
	TaskSummaryOutput,
} from "./engine/types.js";
export { authorized } from "./engine/run-read-model.js";
export { enforceCapScope } from "./engine/scopes.js";
export { event } from "./engine/event-log.js";
export { taskGateLateGrowthMarkers } from "./engine/task-read-model.js";

export const makeEngine = (ctx: EngineContext): Engine => ({
	init: ({ fresh }) => {
		if (fresh) Effect.runSync(ctx.services.fs.removeFile(ctx.config.dbPath));
		const db = openDb(ctx.config.dbPath);
		try {
			migrate(db);
		} finally {
			db.close();
		}
		return { ok: true };
	},
	eventsTail: ({ limit }) => eventsTail(ctx, limit),
	pruneEvents: (input) => pruneEvents(ctx, input),
	...makeScopeOps(ctx),
	...makeRunLifecycleOps(ctx),
	...makeTaskAdmissionOps(ctx),
	...makeClaimLoopOps(ctx),
	...makeInspectOps(ctx),
	...makeRepairAlertOps(ctx),
});
