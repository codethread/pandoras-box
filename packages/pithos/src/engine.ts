import { Effect } from "effect";
import { migrate, openDb } from "./db.js";
import { authorized, enforceCapScope } from "./engine/actors.js";
import { makeClaimLoopOps } from "./engine/claim-loop.js";
import { event, eventsTail, pruneEvents } from "./engine/event-log.js";
import { makeReadOps } from "./engine/read-ops.js";
import { makeRepairAlertOps } from "./engine/repair-alerts.js";
import { makeRunLifecycleOps } from "./engine/run-lifecycle.js";
import { makeScopeOps } from "./engine/scope-ops.js";
import { makeTaskAuthoringOps } from "./engine/task-authoring.js";
import { taskGateLateGrowthMarkers } from "./engine/task-read-model.js";
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
export { authorized, enforceCapScope, event, taskGateLateGrowthMarkers };

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
	...makeTaskAuthoringOps(ctx),
	...makeClaimLoopOps(ctx),
	...makeRepairAlertOps(ctx),
	...makeReadOps(ctx),
});
