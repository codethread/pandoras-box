import { escapeHtml } from "../../lib/utils.js";

export interface RenderButtonOptions {
	readonly label: string;
	readonly action: string;
	readonly tone?: "primary" | "secondary" | "ghost";
	readonly disabled?: boolean;
	readonly value?: string;
	readonly extraAttributes?: readonly [string, string][];
}

export const renderButton = ({
	label,
	action,
	tone = "secondary",
	disabled = false,
	value,
	extraAttributes = [],
}: RenderButtonOptions): string => {
	const attributes = [
		`type="button"`,
		`class="ui-button ui-button--${tone}"`,
		`data-action="${escapeHtml(action)}"`,
		...(value === undefined ? [] : [`data-value="${escapeHtml(value)}"`]),
		...(disabled ? ["disabled"] : []),
		...extraAttributes.map(([key, entryValue]) => `${escapeHtml(key)}="${escapeHtml(entryValue)}"`),
	];
	return `<button ${attributes.join(" ")}>${escapeHtml(label)}</button>`;
};
