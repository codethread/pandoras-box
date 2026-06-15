import type { ScopeViewSetting } from "../stores/settings-store.js";
import { escapeHtml } from "../lib/utils.js";
import { renderButton } from "./ui/button.js";

export const renderScopePicker = (scopeView: ScopeViewSetting, hasTaskFocus: boolean): string => {
	const mode = scopeView.kind;
	return [
		'<div class="control-group">',
		'<label class="control-label" for="scope-mode">Scope view</label>',
		`<select id="scope-mode" class="control-select" data-setting="scope-mode">`,
		`<option value="global"${mode === "global" ? " selected" : ""}>Global</option>`,
		`<option value="all"${mode === "all" ? " selected" : ""}>All scopes</option>`,
		`<option value="scope"${mode === "scope" ? " selected" : ""}>Specific scope</option>`,
		"</select>",
		mode === "scope"
			? `<input id="scope-id" class="control-input" data-setting="scope-id" placeholder="repo:/path or worktree:/path" value="${escapeHtml(scopeView.scopeId)}" />`
			: '<p class="control-hint">Default selector persists locally and resets to global.</p>',
		'<div class="control-actions">',
		renderButton({ label: "Clear", action: "reset-scope", tone: "ghost" }),
		hasTaskFocus
			? renderButton({ label: "Leave task focus", action: "leave-task-focus", tone: "secondary" })
			: "",
		"</div>",
		"</div>",
	].join("");
};
