import { parseGraphSinceCutoff, type GraphSinceCutoff, type TaskStatus } from "@pdx/pithos";

import { GraphExplorerError } from "../errors.js";
import type {
	ExplorerSelector,
	GraphExplorerOptions,
	ResolvedGraphExplorerOptions,
} from "../types.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_SELECTOR: ExplorerSelector = { kind: "global" };
const TASK_STATUSES = [
	"queued",
	"claimed",
	"running",
	"done",
	"failed",
	"dead_letter",
	"cancelled",
] as const satisfies readonly TaskStatus[];
const TASK_STATUS_SET = new Set<TaskStatus>(TASK_STATUSES);

export interface GraphReadRequest {
	readonly selector: ExplorerSelector;
	readonly status: readonly TaskStatus[];
	readonly search: readonly string[];
	readonly since: string | undefined;
	readonly until: string | undefined;
	readonly sinceCutoff: GraphSinceCutoff | undefined;
	readonly untilCutoff: GraphSinceCutoff | undefined;
}

export type GraphWebsocketClientMessage =
	| {
			readonly kind: "refresh";
	  }
	| {
			readonly kind: "subscribe" | "set_selector";
			readonly request: GraphReadRequest;
			readonly lastSuccessAt?: string;
	  };

const requireNonEmptyString = (value: string, label: string): string => {
	if (value.trim().length === 0) {
		throw new GraphExplorerError({
			code: "INVALID_OPTION",
			message: `${label} must be a non-empty string`,
		});
	}

	return value;
};

const normalizeSelector = (selector: ExplorerSelector): ExplorerSelector => {
	switch (selector.kind) {
		case "global":
		case "all":
			return selector;
		case "scope":
			return {
				kind: "scope",
				scopeId: requireNonEmptyString(selector.scopeId, "scopeId"),
			};
		case "task":
			return {
				kind: "task",
				taskId: requireNonEmptyString(selector.taskId, "taskId"),
			};
	}
};

const requireRequestString = (value: string, label: string): string => {
	if (value.trim().length === 0) {
		throw new GraphExplorerError({
			code: "INVALID_REQUEST",
			message: `${label} must be a non-empty string`,
		});
	}

	return value;
};

const isTaskStatus = (value: string): value is TaskStatus =>
	TASK_STATUS_SET.has(value as TaskStatus);

const parseStatusFilter = (value: unknown): readonly TaskStatus[] => {
	if (value === undefined || value === null) {
		return [];
	}

	const rawValues =
		typeof value === "string"
			? [value]
			: Array.isArray(value) && value.every((entry) => typeof entry === "string")
				? value
				: (() => {
						throw new GraphExplorerError({
							code: "INVALID_REQUEST",
							message: "status must be a string or array of strings",
						});
					})();

	const statuses = rawValues
		.flatMap((entry) => entry.split(","))
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
	const uniqueStatuses: TaskStatus[] = [];
	for (const status of statuses) {
		if (!isTaskStatus(status)) {
			throw new GraphExplorerError({
				code: "INVALID_REQUEST",
				message: `Unsupported status '${status}'. Valid values: ${TASK_STATUSES.join(", ")}`,
			});
		}
		if (!uniqueStatuses.includes(status)) {
			uniqueStatuses.push(status);
		}
	}
	return uniqueStatuses;
};

const parseSearchFilter = (value: unknown): readonly string[] => {
	if (value === undefined || value === null) {
		return [];
	}

	const rawValues =
		typeof value === "string"
			? [value]
			: Array.isArray(value) && value.every((entry) => typeof entry === "string")
				? value
				: (() => {
						throw new GraphExplorerError({
							code: "INVALID_REQUEST",
							message: "search must be a string or array of strings",
						});
					})();

	return rawValues.map((entry) => requireRequestString(entry, "search term").trim());
};

const RELATIVE_TIME_FILTER_PATTERN = /^(?:today|\d+[mhd])$/;
const ABSOLUTE_TIME_FILTER_PATTERN =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;

const parseAbsoluteTimeFilter = (
	value: string,
	label: "since" | "until",
	nowIso: string,
): GraphSinceCutoff => {
	if (!ABSOLUTE_TIME_FILTER_PATTERN.test(value)) {
		throw new GraphExplorerError({
			code: "INVALID_REQUEST",
			message: `${label} must be an ISO timestamp with timezone when using an absolute time range`,
		});
	}
	try {
		return parseGraphSinceCutoff(value, nowIso);
	} catch (error) {
		throw new GraphExplorerError({
			code: "INVALID_REQUEST",
			message: error instanceof Error ? error.message : `Invalid ${label} filter`,
		});
	}
};

const parseTimeFilter = (
	sinceValue: unknown,
	untilValue: unknown,
	nowIso: string,
): {
	readonly since: string | undefined;
	readonly until: string | undefined;
	readonly sinceCutoff: GraphSinceCutoff | undefined;
	readonly untilCutoff: GraphSinceCutoff | undefined;
} => {
	if (sinceValue === undefined || sinceValue === null) {
		if (untilValue === undefined || untilValue === null) {
			return {
				since: undefined,
				until: undefined,
				sinceCutoff: undefined,
				untilCutoff: undefined,
			};
		}
		throw new GraphExplorerError({
			code: "INVALID_REQUEST",
			message: "until requires since for bounded absolute time filtering",
		});
	}
	if (typeof sinceValue !== "string") {
		throw new GraphExplorerError({
			code: "INVALID_REQUEST",
			message: "since must be a string",
		});
	}
	const since = requireRequestString(sinceValue, "since").trim();
	if (untilValue === undefined || untilValue === null) {
		if (!RELATIVE_TIME_FILTER_PATTERN.test(since)) {
			throw new GraphExplorerError({
				code: "INVALID_REQUEST",
				message: "absolute time filtering requires both since and until timestamps",
			});
		}
		try {
			return {
				since,
				until: undefined,
				sinceCutoff: parseGraphSinceCutoff(since, nowIso),
				untilCutoff: undefined,
			};
		} catch (error) {
			throw new GraphExplorerError({
				code: "INVALID_REQUEST",
				message: error instanceof Error ? error.message : "Invalid since filter",
			});
		}
	}
	if (typeof untilValue !== "string") {
		throw new GraphExplorerError({
			code: "INVALID_REQUEST",
			message: "until must be a string",
		});
	}
	const until = requireRequestString(untilValue, "until").trim();
	if (RELATIVE_TIME_FILTER_PATTERN.test(since) || RELATIVE_TIME_FILTER_PATTERN.test(until)) {
		throw new GraphExplorerError({
			code: "INVALID_REQUEST",
			message: "bounded time filtering requires absolute since and until timestamps",
		});
	}
	const sinceCutoff = parseAbsoluteTimeFilter(since, "since", nowIso);
	const untilCutoff = parseAbsoluteTimeFilter(until, "until", nowIso);
	if (sinceCutoff.dbTimestamp > untilCutoff.dbTimestamp) {
		throw new GraphExplorerError({
			code: "INVALID_REQUEST",
			message: "until must be greater than or equal to since for absolute time filtering",
		});
	}
	return {
		since,
		until,
		sinceCutoff,
		untilCutoff,
	};
};

const asOptionalString = (value: unknown, label: string): string | undefined => {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new GraphExplorerError({
			code: "INVALID_REQUEST",
			message: `${label} must be a string`,
		});
	}
	return value;
};

const asJsonRecord = (value: unknown): Record<string, unknown> => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new GraphExplorerError({
			code: "INVALID_REQUEST",
			message: "Websocket message must be a JSON object",
		});
	}
	return value as Record<string, unknown>;
};

export const parseGraphExplorerOptions = (
	options: GraphExplorerOptions,
): ResolvedGraphExplorerOptions => {
	const host =
		options.host === undefined ? DEFAULT_HOST : requireNonEmptyString(options.host, "host");
	const port = options.port ?? 0;

	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		throw new GraphExplorerError({
			code: "INVALID_OPTION",
			message: "port must be an integer between 0 and 65535",
		});
	}

	return {
		pithosDbPath: requireNonEmptyString(options.pithosDbPath, "pithosDbPath"),
		pdxDataDir: requireNonEmptyString(options.pdxDataDir, "pdxDataDir"),
		host,
		port,
		initialSelector: normalizeSelector(options.initialSelector ?? DEFAULT_SELECTOR),
	};
};

export const formatSelector = (selector: ExplorerSelector): string => {
	switch (selector.kind) {
		case "global":
			return "global";
		case "all":
			return "all";
		case "scope":
			return `scope:${selector.scopeId}`;
		case "task":
			return `task:${selector.taskId}`;
	}
};

export const parseSelectorParam = (
	value: string | null | undefined,
	fallback: ExplorerSelector,
): ExplorerSelector => {
	if (value === null || value === undefined || value.length === 0) {
		return fallback;
	}

	if (value === "global") {
		return { kind: "global" };
	}

	if (value === "all") {
		return { kind: "all" };
	}

	if (value.startsWith("scope:")) {
		return normalizeSelector({ kind: "scope", scopeId: value.slice("scope:".length) });
	}

	if (value.startsWith("task:")) {
		return normalizeSelector({ kind: "task", taskId: value.slice("task:".length) });
	}

	throw new GraphExplorerError({
		code: "INVALID_REQUEST",
		message: `Unsupported selector '${value}'`,
	});
};

export const parseGraphReadRequestInput = (
	input: {
		readonly selector?: unknown;
		readonly status?: unknown;
		readonly search?: unknown;
		readonly since?: unknown;
		readonly until?: unknown;
	},
	fallbackSelector: ExplorerSelector,
	nowIso: string,
): GraphReadRequest => {
	const selectorValue = asOptionalString(input.selector, "selector");
	const selector = parseSelectorParam(selectorValue, fallbackSelector);
	const status = parseStatusFilter(input.status);
	const search = parseSearchFilter(input.search);
	const { since, until, sinceCutoff, untilCutoff } = parseTimeFilter(
		input.since,
		input.until,
		nowIso,
	);
	return {
		selector,
		status,
		search,
		since,
		until,
		sinceCutoff,
		untilCutoff,
	};
};

export const parseGraphReadRequestQuery = (
	url: URL,
	fallbackSelector: ExplorerSelector,
	nowIso: string,
): GraphReadRequest =>
	parseGraphReadRequestInput(
		{
			selector: url.searchParams.get("selector") ?? undefined,
			status: url.searchParams.getAll("status"),
			search: url.searchParams.getAll("search"),
			since: url.searchParams.get("since") ?? undefined,
			until: url.searchParams.get("until") ?? undefined,
		},
		fallbackSelector,
		nowIso,
	);

export const parseGraphWebsocketClientMessage = (
	input: string,
	fallbackSelector: ExplorerSelector,
	nowIso: string,
): GraphWebsocketClientMessage => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(input) as unknown;
	} catch (error) {
		throw new GraphExplorerError({
			code: "INVALID_REQUEST",
			message:
				error instanceof Error
					? `Invalid websocket JSON: ${error.message}`
					: "Invalid websocket JSON",
		});
	}

	const value = asJsonRecord(parsed);
	if (value.kind === "refresh") {
		return { kind: "refresh" };
	}
	if (value.kind === "subscribe" || value.kind === "set_selector") {
		const lastSuccessAt = asOptionalString(value.lastSuccessAt, "lastSuccessAt");
		return {
			kind: value.kind,
			request: parseGraphReadRequestInput(
				{
					selector: value.selector,
					status: value.status,
					search: value.search,
					since: value.since,
					until: value.until,
				},
				fallbackSelector,
				nowIso,
			),
			...(lastSuccessAt === undefined ? {} : { lastSuccessAt }),
		};
	}

	throw new GraphExplorerError({
		code: "INVALID_REQUEST",
		message: "Unsupported websocket message kind",
	});
};

export const parseTaskIdPath = (pathname: string): string => {
	const taskId = pathname.slice("/api/task/".length).trim();
	if (taskId.length === 0) {
		throw new GraphExplorerError({
			code: "INVALID_REQUEST",
			message: "task id path segment must be non-empty",
		});
	}

	try {
		return decodeURIComponent(taskId);
	} catch {
		throw new GraphExplorerError({
			code: "INVALID_REQUEST",
			message: "task id path segment must be valid percent-encoding",
		});
	}
};
