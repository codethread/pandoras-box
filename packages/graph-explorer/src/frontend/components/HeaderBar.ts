import type { AppRenderModel } from "../view-model.js";
import { escapeHtml, formatRelativeAge } from "../lib/utils.js";
import { REFRESH_INTERVAL_OPTIONS } from "../stores/settings-store.js";
import { renderDaemonStatusBadge } from "./DaemonStatusBadge.js";
import { renderScopePicker } from "./ScopePicker.js";
import { renderTimeRangePicker } from "./TimeRangePicker.js";
import { renderButton } from "./ui/button.js";

const websocketStatusLabel = (status: AppRenderModel["header"]["websocket"]["status"]): string =>
	status === "connected"
		? "WS connected"
		: status === "connecting"
			? "WS connecting"
			: status === "reconnecting"
				? "WS reconnecting"
				: status === "error"
					? "WS error"
					: "WS disconnected";

export const renderHeaderBar = (model: AppRenderModel): string => {
	const refreshOptions = REFRESH_INTERVAL_OPTIONS.map(
		(value) =>
			`<option value="${String(value)}"${value === model.settings.refreshIntervalSeconds ? " selected" : ""}>${String(value)}s</option>`,
	).join("");
	const websocketTone =
		model.header.websocket.status === "connected"
			? "good"
			: model.header.websocket.status === "connecting" ||
				  model.header.websocket.status === "reconnecting"
				? "muted"
				: "warn";
	return [
		'<header class="page-header panel">',
		'<div class="page-header__intro">',
		"<div>",
		'<p class="eyebrow">pdx ui</p>',
		"<h1>Pithos Graph Explorer</h1>",
		'<p class="lede">Read-only SPA shell with persisted view settings, manual refresh, daemon status, and websocket freshness.</p>',
		"</div>",
		'<div class="status-row">',
		renderDaemonStatusBadge(model.header.daemonStatus),
		`<span class="status-badge status-badge--${websocketTone}">${websocketStatusLabel(model.header.websocket.status)}</span>`,
		`<span class="status-badge status-badge--${model.header.freshness.status === "fresh" ? "good" : model.header.freshness.status === "empty" ? "muted" : "warn"}">${model.header.freshness.label}</span>`,
		`<span class="status-meta">Updated ${model.header.lastGraphUpdateLabel}</span>`,
		model.header.websocket.lastMessageAt === null
			? ""
			: `<span class="status-meta">Last push ${formatRelativeAge(model.header.websocket.lastMessageAt)}</span>`,
		"</div>",
		"</div>",
		'<div class="control-grid">',
		renderScopePicker(model.activeScopeView, model.hasTaskFocus),
		renderTimeRangePicker(model.activeTimeFilter),
		[
			'<div class="control-group">',
			'<label class="control-label" for="refresh-interval">Refresh cadence</label>',
			`<select id="refresh-interval" class="control-select" data-setting="refresh-interval">${refreshOptions}</select>`,
			'<p class="control-hint">Client refresh timer. Server websocket polling still runs every 30s.</p>',
			'<div class="control-actions">',
			renderButton({
				label: model.header.refreshInFlight ? "Refreshing…" : "Refresh now",
				action: "refresh",
				tone: "primary",
				disabled: model.header.refreshInFlight,
			}),
			renderButton({ label: "Reset", action: "reset-refresh-interval", tone: "ghost" }),
			"</div>",
			"</div>",
		].join(""),
		"</div>",
		model.header.settingsNotice === null
			? ""
			: `<p class="banner banner--warn">${escapeHtml(model.header.settingsNotice)}</p>`,
		model.header.staleMessage === null
			? ""
			: `<p class="banner banner--warn">${escapeHtml(model.header.staleMessage)}</p>`,
		model.header.errorMessage === null
			? ""
			: `<p class="banner banner--error">${escapeHtml(model.header.errorMessage)}</p>`,
		"</header>",
	].join("");
};
