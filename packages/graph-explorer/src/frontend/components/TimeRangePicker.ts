import type { TimeFilterSetting } from "../stores/settings-store.js";
import { escapeHtml } from "../lib/utils.js";
import { renderButton } from "./ui/button.js";

export const renderTimeRangePicker = (timeFilter: TimeFilterSetting): string => {
	const mode = timeFilter.kind;
	return [
		'<div class="control-group">',
		'<label class="control-label" for="time-filter-mode">Time filter</label>',
		`<select id="time-filter-mode" class="control-select" data-setting="time-filter-mode">`,
		`<option value="off"${mode === "off" ? " selected" : ""}>All time</option>`,
		`<option value="30m"${mode === "relative" && timeFilter.value === "30m" ? " selected" : ""}>Last 30m</option>`,
		`<option value="1h"${mode === "relative" && timeFilter.value === "1h" ? " selected" : ""}>Last 1h</option>`,
		`<option value="6h"${mode === "relative" && timeFilter.value === "6h" ? " selected" : ""}>Last 6h</option>`,
		`<option value="1d"${mode === "relative" && timeFilter.value === "1d" ? " selected" : ""}>Last 1d</option>`,
		`<option value="absolute"${mode === "absolute" ? " selected" : ""}>Absolute range</option>`,
		"</select>",
		mode === "absolute"
			? [
					`<input id="time-filter-absolute-since" type="datetime-local" class="control-input" data-setting="time-filter-absolute-since" value="${escapeHtml(timeFilter.sinceLocal)}" />`,
					`<input id="time-filter-absolute-until" type="datetime-local" class="control-input" data-setting="time-filter-absolute-until" value="${escapeHtml(timeFilter.untilLocal)}" />`,
					'<p class="control-hint">Absolute mode requires both start and end timestamps.</p>',
				].join("")
			: '<p class="control-hint">Use a relative window or switch to a bounded absolute range.</p>',
		renderButton({ label: "Clear", action: "reset-time-filter", tone: "ghost" }),
		"</div>",
	].join("");
};
