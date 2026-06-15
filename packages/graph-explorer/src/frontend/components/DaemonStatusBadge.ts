import type { FrontendDaemonStatus } from "../api.js";
import { escapeHtml } from "../lib/utils.js";

export const renderDaemonStatusBadge = (status: FrontendDaemonStatus | null): string => {
	if (status === null) {
		return '<span class="status-badge status-badge--muted">Daemon: loading</span>';
	}
	const tone =
		status.status === "running" ? "good" : status.status === "not_running" ? "muted" : "warn";
	if (status.status !== "running") {
		return `<span class="status-badge status-badge--${tone}" title="${escapeHtml(status.message)}">Daemon: ${escapeHtml(status.status.replaceAll("_", " "))}</span>`;
	}
	const intakeLabel = status.intakeSocketPath === null ? "Intake off" : "Intake on";
	return [
		`<span class="status-badge status-badge--${tone}" title="${escapeHtml(status.message)}">`,
		"<span>Daemon: running</span>",
		`<span class="status-badge__detail">AFK ${String(status.afkUsed)}/${String(status.maxAfk)}</span>`,
		`<span class="status-badge__detail">Registry ${String(status.registryEntries)}</span>`,
		`<span class="status-badge__detail">${intakeLabel}</span>`,
		"</span>",
	].join("");
};
