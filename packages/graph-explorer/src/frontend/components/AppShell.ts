import type { AppRenderModel } from "../view-model.js";
import { renderFilterDrawer } from "./FilterDrawer.js";
import { renderGraphCanvas } from "./GraphCanvas.js";
import { renderHeaderBar } from "./HeaderBar.js";
import { renderInspectorPanel } from "./InspectorPanel.js";

export const renderAppShell = (model: AppRenderModel): string =>
	[
		renderHeaderBar(model),
		'<main class="page-grid">',
		renderFilterDrawer(model),
		renderGraphCanvas(model),
		renderInspectorPanel(model),
		"</main>",
	].join("");
