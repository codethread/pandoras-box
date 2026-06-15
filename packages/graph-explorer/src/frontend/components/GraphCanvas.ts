import type { AppRenderModel } from "../view-model.js";
import { escapeHtml } from "../lib/utils.js";

export const renderGraphCanvas = (model: AppRenderModel): string => {
	const nodeCount = model.graphView?.nodeCount ?? 0;
	const edgeCount = model.graphView?.edgeCount ?? 0;
	const focusHint =
		model.inspector.selectedTaskId === null
			? "Click any node to inspect task detail. Stable ids preserve selection, camera state, and layout between refreshes when topology is unchanged. Gate edges stay stateful: green clear, amber open, red broken."
			: `Focused task: ${escapeHtml(model.inspector.selectedTaskId)}. Branch members stay highlighted while unrelated work dims; gate checkpoints keep their clear/open/broken colors.`;

	return [
		'<section class="panel panel--canvas">',
		'<div class="panel-heading">',
		"<div>",
		"<h2>Task graph</h2>",
		'<p class="muted">Graphology + Sigma.js render the live Pithos snapshot; dagre layout runs in an ES module worker.</p>',
		"</div>",
		`<div class="canvas-stats"><span>${String(nodeCount)} nodes</span><span>${String(edgeCount)} edges</span><span>Δ +${String(model.graphDiff.addedNodeIds.length)} / -${String(model.graphDiff.removedNodeIds.length)} / ~${String(model.graphDiff.changedNodeIds.length + model.graphDiff.changedEdgeIds.length)}</span></div>`,
		"</div>",
		`<p class="graph-canvas__hint">${focusHint}</p>`,
		'<div class="graph-canvas__surface" data-role="graph-canvas-host">',
		model.graphSnapshot === null
			? `<p class="empty-state">${escapeHtml(model.graphEmptyMessage)}</p>`
			: '<p class="empty-state">Preparing graph canvas…</p>',
		"</div>",
		"</section>",
	].join("");
};
