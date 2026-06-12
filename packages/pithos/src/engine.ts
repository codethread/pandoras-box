import { Effect } from "effect";
import { migrate, openDb } from "./db.js";
import { makeClaimLoopOps } from "./engine/claim-loop.js";
import { eventsTail, pruneEvents } from "./engine/event-log.js";
import {
	authorized,
	enforceCapScope,
	liveRun,
	requireNonEmpty,
	resolveRunId,
	scopeForCapability,
} from "./engine/guards.js";
import { makeInspectionOps } from "./engine/inspection.js";
import { makeRepairAlertOps } from "./engine/repair-alerts.js";
import { makeRunLifecycleOps } from "./engine/run-lifecycle.js";
import { makeScopeOps } from "./engine/scope-ops.js";
import { makeTaskMutationOps } from "./engine/task-mutations.js";
export { parseGraphSinceCutoff } from "./engine/graph-inspect.js";
export {
	renderArtifactListText,
	renderArtifactShowText,
	renderBriefingText,
	renderGraphInspectText,
	renderTaskInspectMarkdown,
} from "./engine/render.js";
export { PDX_SYSTEM_RUN_ID } from "./engine/types.js";
import type { Engine, EngineContext } from "./engine/types.js";
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
	...makeScopeOps(ctx),
	...makeRunLifecycleOps(ctx),
	eventsTail: ({ limit }) => eventsTail(ctx, limit),
	pruneEvents: (input) => pruneEvents(ctx, input),
	...makeTaskMutationOps(ctx),
	...makeClaimLoopOps(ctx, {
		requireNonEmpty,
		resolveRunId,
		liveRun,
		authorized,
		enforceCapScope,
	}),
	...makeInspectionOps(ctx),
	...makeRepairAlertOps(ctx, {
		requireNonEmpty,
		resolveRunId,
		liveRun,
		scopeForCapability,
	}),
});

export { authorized } from "./engine/guards.js";
export { event } from "./engine/event-log.js";
export { taskGateLateGrowthMarkers } from "./engine/task-read-model.js";
