import { capabilityBadgeStyles, gateStateStyles } from "../graph/visual-style.js";

const capabilityItems = Object.values(capabilityBadgeStyles)
	.map(
		(style) =>
			`<li><span class="legend-chip" style="--legend-color: ${style.color}">${style.glyph}</span> ${style.evil} / ${style.capability}</li>`,
	)
	.join("");

const edgeItems = [
	'<li><span class="legend-edge legend-edge--after"></span> after</li>',
	`<li><span class="legend-edge legend-edge--gate-clear" style="--legend-color: ${gateStateStyles.clear.color}"></span> ${gateStateStyles.clear.label}</li>`,
	`<li><span class="legend-edge legend-edge--gate-open" style="--legend-color: ${gateStateStyles.open.color}"></span> ${gateStateStyles.open.label}</li>`,
	`<li><span class="legend-edge legend-edge--gate-broken" style="--legend-color: ${gateStateStyles.broken.color}"></span> ${gateStateStyles.broken.label}</li>`,
	'<li><span class="legend-edge legend-edge--about"></span> about</li>',
	'<li><span class="legend-edge legend-edge--repair"></span> repair</li>',
	'<li><span class="legend-edge legend-edge--supersedes"></span> supersedes</li>',
].join("");

export const renderGraphLegend = (): string =>
	[
		'<div class="legend">',
		"<h3>Legend</h3>",
		'<ul class="legend-list">',
		'<li><span class="legend-swatch legend-swatch--claimable"></span> Claimable</li>',
		'<li><span class="legend-swatch legend-swatch--running"></span> Running / claimed</li>',
		'<li><span class="legend-swatch legend-swatch--done"></span> Done</li>',
		'<li><span class="legend-swatch legend-swatch--broken"></span> Broken / stopped</li>',
		'<li><span class="legend-swatch legend-swatch--queued"></span> Queued</li>',
		"</ul>",
		"<h3>Evils / capabilities</h3>",
		`<ul class="legend-list">${capabilityItems}</ul>`,
		"<h3>Edge kinds</h3>",
		`<ul class="legend-list">${edgeItems}</ul>`,
		'<p class="muted">Branch focus preserves task colors, dims unrelated work, and keeps gate checkpoints stateful.</p>',
		"</div>",
	].join("");
