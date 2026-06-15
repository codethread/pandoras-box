import type { ExplorerSelector } from "../../types.js";

export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export type RelativeTimeFilterValue = "30m" | "1h" | "6h" | "1d";

export type ScopeViewSetting =
	| { readonly kind: "global" }
	| { readonly kind: "all" }
	| { readonly kind: "scope"; readonly scopeId: string };

export type TimeFilterSetting =
	| { readonly kind: "off" }
	| { readonly kind: "relative"; readonly value: RelativeTimeFilterValue }
	| { readonly kind: "absolute"; readonly sinceLocal: string; readonly untilLocal: string };

export interface GraphExplorerSettings {
	readonly scopeView: ScopeViewSetting;
	readonly refreshIntervalSeconds: number;
	readonly timeFilter: TimeFilterSetting;
}

export interface SettingsLoadResult {
	readonly settings: GraphExplorerSettings;
	readonly recovered: boolean;
	readonly message: string | null;
}

export const GRAPH_EXPLORER_STORAGE_KEY = "pdx.graph-explorer.settings.v1";
export const DEFAULT_REFRESH_INTERVAL_SECONDS = 30;
export const REFRESH_INTERVAL_OPTIONS = [15, 30, 60, 120, 300] as const;
export const RELATIVE_TIME_FILTER_OPTIONS = [
	"30m",
	"1h",
	"6h",
	"1d",
] as const satisfies readonly RelativeTimeFilterValue[];

const SETTINGS_VERSION = 2;
const REFRESH_INTERVAL_SET = new Set<number>(REFRESH_INTERVAL_OPTIONS);
const RELATIVE_FILTER_SET = new Set<RelativeTimeFilterValue>(RELATIVE_TIME_FILTER_OPTIONS);

export const defaultSettingsState: GraphExplorerSettings = {
	scopeView: { kind: "global" },
	refreshIntervalSeconds: DEFAULT_REFRESH_INTERVAL_SECONDS,
	timeFilter: { kind: "off" },
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
};

const parseScopeView = (value: unknown): ScopeViewSetting | null => {
	const record = asRecord(value);
	if (record === null || typeof record.kind !== "string") {
		return null;
	}
	switch (record.kind) {
		case "global":
			return { kind: "global" };
		case "all":
			return { kind: "all" };
		case "scope": {
			if (typeof record.scopeId !== "string" || record.scopeId.trim().length === 0) {
				return null;
			}
			return { kind: "scope", scopeId: record.scopeId.trim() };
		}
		default:
			return null;
	}
};

const isValidLocalDateTimeInput = (value: string): boolean => {
	if (value.trim().length === 0) {
		return false;
	}
	const date = new Date(value);
	return !Number.isNaN(date.getTime());
};

const parseTimeFilter = (value: unknown): TimeFilterSetting | null => {
	const record = asRecord(value);
	if (record === null || typeof record.kind !== "string") {
		return null;
	}
	switch (record.kind) {
		case "off":
			return { kind: "off" };
		case "relative":
			return typeof record.value === "string" &&
				RELATIVE_FILTER_SET.has(record.value as RelativeTimeFilterValue)
				? { kind: "relative", value: record.value as RelativeTimeFilterValue }
				: null;
		case "absolute":
			return typeof record.sinceLocal === "string" &&
				typeof record.untilLocal === "string" &&
				isValidLocalDateTimeInput(record.sinceLocal) &&
				isValidLocalDateTimeInput(record.untilLocal)
				? { kind: "absolute", sinceLocal: record.sinceLocal, untilLocal: record.untilLocal }
				: null;
		default:
			return null;
	}
};

const parseRefreshInterval = (value: unknown): number | null => {
	if (typeof value !== "number" || !Number.isInteger(value)) {
		return null;
	}
	if (!REFRESH_INTERVAL_SET.has(value)) {
		return null;
	}
	return value;
};

export const parseStoredSettings = (input: string): SettingsLoadResult => {
	try {
		const parsed = JSON.parse(input) as unknown;
		const record = asRecord(parsed);
		if (record?.version !== SETTINGS_VERSION) {
			return {
				settings: defaultSettingsState,
				recovered: true,
				message: "Stored explorer settings were invalid and have been reset.",
			};
		}
		const scopeView = parseScopeView(record.scopeView);
		const refreshIntervalSeconds = parseRefreshInterval(record.refreshIntervalSeconds);
		const timeFilter = parseTimeFilter(record.timeFilter);
		const recovered = scopeView === null || refreshIntervalSeconds === null || timeFilter === null;
		return {
			settings: {
				scopeView: scopeView ?? defaultSettingsState.scopeView,
				refreshIntervalSeconds: refreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS,
				timeFilter: timeFilter ?? defaultSettingsState.timeFilter,
			},
			recovered,
			message: recovered
				? "Stored explorer settings were partially invalid and defaults were restored."
				: null,
		};
	} catch {
		return {
			settings: defaultSettingsState,
			recovered: true,
			message: "Stored explorer settings could not be parsed and were reset.",
		};
	}
};

export const loadSettings = (storage: StorageLike | null | undefined): SettingsLoadResult => {
	if (storage === null || storage === undefined) {
		return { settings: defaultSettingsState, recovered: false, message: null };
	}
	const raw = storage.getItem(GRAPH_EXPLORER_STORAGE_KEY);
	if (raw === null) {
		return { settings: defaultSettingsState, recovered: false, message: null };
	}
	return parseStoredSettings(raw);
};

export const saveSettings = (
	storage: StorageLike | null | undefined,
	settings: GraphExplorerSettings,
): void => {
	storage?.setItem(
		GRAPH_EXPLORER_STORAGE_KEY,
		JSON.stringify({
			version: SETTINGS_VERSION,
			scopeView: settings.scopeView,
			refreshIntervalSeconds: settings.refreshIntervalSeconds,
			timeFilter: settings.timeFilter,
		}),
	);
};

export const scopeViewToSelector = (scopeView: ScopeViewSetting): ExplorerSelector => {
	switch (scopeView.kind) {
		case "global":
			return { kind: "global" };
		case "all":
			return { kind: "all" };
		case "scope":
			return { kind: "scope", scopeId: scopeView.scopeId };
	}
};

export const selectorLabelFromScopeView = (scopeView: ScopeViewSetting): string => {
	switch (scopeView.kind) {
		case "global":
			return "Global";
		case "all":
			return "All scopes";
		case "scope":
			return `Scope: ${scopeView.scopeId}`;
	}
};

const localDateTimeToParameter = (value: string): string | undefined => {
	if (!isValidLocalDateTimeInput(value)) {
		return undefined;
	}
	return new Date(value).toISOString();
};

export const timeFilterRequestValidationMessage = (
	timeFilter: TimeFilterSetting,
): string | null => {
	if (timeFilter.kind !== "absolute") {
		return null;
	}
	return isValidLocalDateTimeInput(timeFilter.sinceLocal) &&
		isValidLocalDateTimeInput(timeFilter.untilLocal)
		? null
		: "Absolute time filter requires both start and end timestamps before refresh.";
};

export const timeFilterToQueryParameters = (
	timeFilter: TimeFilterSetting,
): { readonly since: string | undefined; readonly until: string | undefined } => {
	switch (timeFilter.kind) {
		case "off":
			return { since: undefined, until: undefined };
		case "relative":
			return { since: timeFilter.value, until: undefined };
		case "absolute":
			return {
				since: localDateTimeToParameter(timeFilter.sinceLocal),
				until: localDateTimeToParameter(timeFilter.untilLocal),
			};
	}
};

export const timeFilterLabel = (timeFilter: TimeFilterSetting): string => {
	switch (timeFilter.kind) {
		case "off":
			return "All time";
		case "relative":
			return `Last ${timeFilter.value}`;
		case "absolute": {
			const sinceLabel = timeFilter.sinceLocal.trim().length > 0 ? timeFilter.sinceLocal : "…";
			const untilLabel = timeFilter.untilLocal.trim().length > 0 ? timeFilter.untilLocal : "…";
			return `Between ${sinceLabel} and ${untilLabel}`;
		}
	}
};

export const updateScopeViewMode = (
	settings: GraphExplorerSettings,
	mode: ScopeViewSetting["kind"],
): GraphExplorerSettings => ({
	...settings,
	scopeView:
		mode === "scope"
			? settings.scopeView.kind === "scope" && settings.scopeView.scopeId.length > 0
				? settings.scopeView
				: { kind: "scope", scopeId: "" }
			: { kind: mode },
});

export const updateScopeId = (
	settings: GraphExplorerSettings,
	scopeId: string,
): GraphExplorerSettings => ({
	...settings,
	scopeView: { kind: "scope", scopeId: scopeId.trim() },
});

export const updateRefreshInterval = (
	settings: GraphExplorerSettings,
	refreshIntervalSeconds: number,
): GraphExplorerSettings => ({
	...settings,
	refreshIntervalSeconds: REFRESH_INTERVAL_SET.has(refreshIntervalSeconds)
		? refreshIntervalSeconds
		: DEFAULT_REFRESH_INTERVAL_SECONDS,
});

export const updateTimeFilter = (
	settings: GraphExplorerSettings,
	timeFilter: TimeFilterSetting,
): GraphExplorerSettings => ({
	...settings,
	timeFilter,
});
