import type { FrontendTaskGate, FrontendTaskSourceSummary, FrontendTaskSummary } from "../api.js";
import type { AppRenderModel } from "../view-model.js";
import { escapeHtml } from "../lib/utils.js";
import { renderButton } from "./ui/button.js";

const renderTaskSummaryList = (title: string, items: readonly FrontendTaskSummary[]): string =>
	items.length === 0
		? `<div class="inspector-block"><h3>${title}</h3><p class="muted">None.</p></div>`
		: [
				`<div class="inspector-block"><h3>${title}</h3><ul class="inspector-list">`,
				items
					.map(
						(item) =>
							`<li><strong>${escapeHtml(item.title)}</strong><span class="muted">${escapeHtml(item.capability)} · ${escapeHtml(item.status)} · ${escapeHtml(item.scopeId)}</span></li>`,
					)
					.join(""),
				"</ul></div>",
			].join("");

const renderContextList = (title: string, items: readonly FrontendTaskSourceSummary[]): string =>
	items.length === 0
		? `<div class="inspector-block"><h3>${title}</h3><p class="muted">None.</p></div>`
		: [
				`<div class="inspector-block"><h3>${title}</h3><ul class="inspector-list">`,
				items
					.map(
						(item) =>
							`<li><strong>${escapeHtml(item.title)}</strong><span class="muted">${escapeHtml(item.sourceKind)} · ${escapeHtml(item.capability)} · ${escapeHtml(item.status)}</span></li>`,
					)
					.join(""),
				"</ul></div>",
			].join("");

const renderGateList = (gates: readonly FrontendTaskGate[]): string =>
	gates.length === 0
		? '<div class="inspector-block"><h3>Gates</h3><p class="muted">No gate relationships.</p></div>'
		: [
				'<div class="inspector-block"><h3>Gates</h3><ul class="inspector-list">',
				gates
					.map(
						(gate) =>
							`<li><strong>${escapeHtml(gate.targetTaskId)}</strong><span class="muted">state ${escapeHtml(gate.state)} · ${String(gate.members.length)} branch members</span></li>`,
					)
					.join(""),
				"</ul></div>",
			].join("");

export const renderInspectorPanel = (model: AppRenderModel): string => {
	if (model.inspector.selectedTaskId === null) {
		return [
			'<aside class="panel panel--inspector">',
			'<div class="panel-heading"><h2>Inspector</h2><p class="muted">Select a graph node to inspect read-only detail.</p></div>',
			'<p class="empty-state">The inspector keeps rich content out of nodes: task metadata, body, relationships, gates, context links, and artifact refs render here.</p>',
			"</aside>",
		].join("");
	}
	if (model.inspector.loading && model.inspector.taskSnapshot === null) {
		return [
			'<aside class="panel panel--inspector">',
			'<div class="panel-heading"><h2>Inspector</h2></div>',
			`<p class="empty-state">Loading ${escapeHtml(model.inspector.selectedTaskId)}…</p>`,
			"</aside>",
		].join("");
	}
	if (model.inspector.taskSnapshot === null) {
		return [
			'<aside class="panel panel--inspector">',
			'<div class="panel-heading"><h2>Inspector</h2></div>',
			`<p class="banner banner--error">${escapeHtml(model.inspector.errorMessage ?? "Task detail is unavailable.")}</p>`,
			renderButton({ label: "Clear selection", action: "clear-selection", tone: "ghost" }),
			"</aside>",
		].join("");
	}

	const snapshot = model.inspector.taskSnapshot;
	const task = snapshot.task;
	return [
		'<aside class="panel panel--inspector">',
		'<div class="panel-heading">',
		"<div>",
		"<h2>Inspector</h2>",
		`<p class="muted">${escapeHtml(task.capability)} · ${escapeHtml(task.status)} · ${escapeHtml(task.scopeId)}</p>`,
		"</div>",
		renderButton({ label: "Clear", action: "clear-selection", tone: "ghost" }),
		"</div>",
		model.inspector.errorMessage === null
			? ""
			: `<p class="banner banner--warn">${escapeHtml(model.inspector.errorMessage)}</p>`,
		'<div class="inspector-block">',
		`<h3>${escapeHtml(task.title)}</h3>`,
		'<dl class="inspector-meta-grid">',
		`<div><dt>Task id</dt><dd>${escapeHtml(task.id)}</dd></div>`,
		`<div><dt>Scope</dt><dd>${escapeHtml(task.scopeKind)} · ${escapeHtml(task.scopeId)}</dd></div>`,
		`<div><dt>Claimable</dt><dd>${task.claimable ? "yes" : "no"}</dd></div>`,
		`<div><dt>Unresolved deps</dt><dd>${String(task.unresolvedDependencyIds.length)}</dd></div>`,
		`<div><dt>Artifacts</dt><dd>${String(task.artifacts.length)}</dd></div>`,
		`<div><dt>Supersedes</dt><dd>${escapeHtml(snapshot.supersedes ?? "—")}</dd></div>`,
		`<div><dt>Superseded by</dt><dd>${escapeHtml(snapshot.supersededBy ?? "—")}</dd></div>`,
		"</dl>",
		"</div>",
		`<div class="inspector-block"><h3>Body</h3><pre class="inspector-body">${escapeHtml(task.body)}</pre></div>`,
		snapshot.source === null
			? '<div class="inspector-block"><h3>Source</h3><p class="muted">No direct about/repair source.</p></div>'
			: `<div class="inspector-block"><h3>Source</h3><p><strong>${escapeHtml(snapshot.source.title)}</strong> <span class="muted">${escapeHtml(snapshot.source.sourceKind)} · ${escapeHtml(snapshot.source.capability)} · ${escapeHtml(snapshot.source.status)}</span></p></div>`,
		renderContextList("Attached context", snapshot.attachedContext),
		renderTaskSummaryList("Dependencies", task.dependencies),
		renderTaskSummaryList("Dependents", task.dependents),
		renderGateList(task.gates),
		task.artifacts.length === 0
			? '<div class="inspector-block"><h3>Artifact refs</h3><p class="muted">No attached artifacts.</p></div>'
			: `<div class="inspector-block"><h3>Artifact refs</h3><ul class="inspector-list">${task.artifacts.map((artifact) => `<li><strong>${escapeHtml(artifact.title)}</strong><span class="muted">${escapeHtml(artifact.kind)} · ${escapeHtml(artifact.id)}</span></li>`).join("")}</ul></div>`,
		"</aside>",
	].join("");
};
