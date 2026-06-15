import type { ExplorerSelector } from "../types.js";

export interface ExplorerRouteDefinition {
	readonly path: string;
	readonly label: string;
}

export interface ExplorerRouteState {
	readonly kind: "root" | "selector" | "task";
	readonly selectorOverride: ExplorerSelector | null;
	readonly selectedTaskId: string | null;
}

export const placeholderRoutes: readonly ExplorerRouteDefinition[] = [
	{ path: "/", label: "scope view" },
	{ path: "/all", label: "all scopes" },
	{ path: "/scope/:scopeId", label: "scope focus" },
	{ path: "/task/:taskId", label: "task focus" },
];

const decodePathSegment = (value: string): string | null => {
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
};

export const parseExplorerRoute = (pathname: string): ExplorerRouteState => {
	if (pathname === "/" || pathname.length === 0) {
		return { kind: "root", selectorOverride: null, selectedTaskId: null };
	}
	if (pathname === "/all") {
		return { kind: "selector", selectorOverride: { kind: "all" }, selectedTaskId: null };
	}
	if (pathname.startsWith("/scope/")) {
		const scopeId = decodePathSegment(pathname.slice("/scope/".length));
		if (scopeId !== null && scopeId.trim().length > 0) {
			return {
				kind: "selector",
				selectorOverride: { kind: "scope", scopeId },
				selectedTaskId: null,
			};
		}
	}
	if (pathname.startsWith("/task/")) {
		const taskId = decodePathSegment(pathname.slice("/task/".length));
		if (taskId !== null && taskId.trim().length > 0) {
			return {
				kind: "task",
				selectorOverride: { kind: "task", taskId },
				selectedTaskId: taskId,
			};
		}
	}
	return { kind: "root", selectorOverride: null, selectedTaskId: null };
};

export const pathForSelector = (selector: ExplorerSelector): string => {
	switch (selector.kind) {
		case "global":
			return "/";
		case "all":
			return "/all";
		case "scope":
			return `/scope/${encodeURIComponent(selector.scopeId)}`;
		case "task":
			return `/task/${encodeURIComponent(selector.taskId)}`;
	}
};
