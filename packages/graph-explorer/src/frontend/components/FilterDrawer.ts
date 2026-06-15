import type { AppRenderModel } from "../view-model.js";
import { escapeHtml, summarizeCountMap } from "../lib/utils.js";
import { timeFilterLabel } from "../stores/settings-store.js";
import { renderGraphLegend } from "./GraphLegend.js";
import { renderCommandShell } from "./ui/command.js";
import { renderSheetShell } from "./ui/sheet.js";

const renderSummaryList = (title: string, items: readonly string[]): string =>
	[
		`<div class="summary-block"><h3>${title}</h3>`,
		items.length === 0
			? '<p class="muted">No data yet.</p>'
			: `<ul class="summary-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
		"</div>",
	].join("");

export const renderFilterDrawer = (model: AppRenderModel): string => {
	const graphView = model.graphView;
	return renderSheetShell(
		renderCommandShell(
			[
				'<div class="panel-heading"><h2>Filters / Legend</h2><p class="muted">This slice keeps filtering lightweight and focuses on graph semantics, branch focus, and inspector detail.</p></div>',
				`<p class="summary-chip">Active selector: ${escapeHtml(model.activeSelectorLabel)}</p>`,
				`<p class="summary-chip">Time filter: ${escapeHtml(timeFilterLabel(model.activeTimeFilter))}</p>`,
				graphView === null
					? '<p class="muted">Graph summary appears after the first successful snapshot.</p>'
					: [
							renderSummaryList("Status", summarizeCountMap(graphView.statusCounts)),
							renderSummaryList("Capabilities", summarizeCountMap(graphView.capabilityCounts)),
							renderSummaryList("Edges", summarizeCountMap(graphView.edgeCounts)),
						].join(""),
				renderGraphLegend(),
			].join(""),
		),
	);
};
