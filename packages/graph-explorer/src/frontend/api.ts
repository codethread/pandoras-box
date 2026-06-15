import type { ExplorerSelector } from "../types.js";
import type { TimeFilterSetting } from "./stores/settings-store.js";
import { timeFilterToQueryParameters } from "./stores/settings-store.js";

export type FrontendCapability =
	| "clarify"
	| "design"
	| "escalate"
	| "execute"
	| "intake"
	| "review"
	| "triage";
export type FrontendTaskStatus =
	| "queued"
	| "claimed"
	| "running"
	| "done"
	| "failed"
	| "dead_letter"
	| "cancelled";
export type FrontendScopeKind = "global" | "repo" | "worktree";
export type FrontendGateState = "clear" | "open" | "broken";
export type FrontendContextKind = "about" | "repair";

export interface ExplorerConfig {
	readonly host: string;
	readonly port: number;
	readonly initialSelector: ExplorerSelector;
	readonly selectorLabel: string;
	readonly websocketPath: string;
}

export interface FrontendArtifactRef {
	readonly id: string;
	readonly kind: string;
	readonly title: string;
}

export interface FrontendGraphNode {
	readonly id: string;
	readonly title: string;
	readonly capability: FrontendCapability;
	readonly status: FrontendTaskStatus;
	readonly scopeId: string;
	readonly scopeKind: FrontendScopeKind;
	readonly preview: string | null;
	readonly claimable: boolean;
	readonly unresolvedDependencyIds: readonly string[];
	readonly artifactRefs: readonly FrontendArtifactRef[];
}

export interface FrontendGraphEdge {
	readonly kind: "after" | "about" | "repair" | "gate" | "supersedes";
	readonly fromTaskId: string;
	readonly toTaskId: string;
	readonly state?: FrontendGateState;
}

export interface FrontendGraphSnapshot {
	readonly kind: "graph_snapshot";
	readonly selector: ExplorerSelector;
	readonly generatedAt: string;
	readonly graph: {
		readonly nodes: readonly FrontendGraphNode[];
		readonly edges: readonly FrontendGraphEdge[];
	};
	readonly filters: {
		readonly status: readonly FrontendTaskStatus[];
		readonly search: readonly string[];
		readonly since: string | undefined;
		readonly until: string | undefined;
	};
	readonly pithosDbPath: string;
}

export interface FrontendTaskSummary {
	readonly id: string;
	readonly title: string;
	readonly capability: FrontendCapability;
	readonly status: FrontendTaskStatus;
	readonly scopeId: string;
	readonly scopeKind: FrontendScopeKind;
}

export interface FrontendTaskSourceSummary extends FrontendTaskSummary {
	readonly sourceKind: FrontendContextKind;
}

export interface FrontendTaskGateMember {
	readonly taskId: string;
	readonly canonicalTaskId: string;
	readonly status: FrontendTaskStatus;
}

export interface FrontendTaskGate {
	readonly targetTaskId: string;
	readonly state: FrontendGateState;
	readonly members: readonly FrontendTaskGateMember[];
}

export interface FrontendTaskSnapshot {
	readonly kind: "task_snapshot";
	readonly taskId: string;
	readonly generatedAt: string;
	readonly task: {
		readonly id: string;
		readonly title: string;
		readonly body: string;
		readonly capability: FrontendCapability;
		readonly status: FrontendTaskStatus;
		readonly scopeId: string;
		readonly scopeKind: FrontendScopeKind;
		readonly claimable: boolean;
		readonly unresolvedDependencyIds: readonly string[];
		readonly gates: readonly FrontendTaskGate[];
		readonly dependencies: readonly FrontendTaskSummary[];
		readonly dependents: readonly FrontendTaskSummary[];
		readonly artifacts: readonly FrontendArtifactRef[];
	};
	readonly source: FrontendTaskSourceSummary | null;
	readonly attachedContext: readonly FrontendTaskSourceSummary[];
	readonly supersedes: string | null;
	readonly supersededBy: string | null;
	readonly pithosDbPath: string;
}

export type FrontendDaemonStatus =
	| {
			readonly status: "running";
			readonly socketPath: string;
			readonly maxAfk: number;
			readonly afkUsed: number;
			readonly registryEntries: number;
			readonly intakeSocketPath: string | null;
			readonly message: string;
	  }
	| {
			readonly status: "not_running";
			readonly socketPath: string;
			readonly message: string;
	  }
	| {
			readonly status: "unreachable";
			readonly socketPath: string;
			readonly message: string;
	  };

export type GraphWebsocketServerMessage =
	| {
			readonly kind: "snapshot";
			readonly revision: number;
			readonly snapshot: FrontendGraphSnapshot;
	  }
	| {
			readonly kind: "daemon_status";
			readonly daemonStatus: FrontendDaemonStatus;
	  }
	| {
			readonly kind: "stale";
			readonly message: string;
			readonly lastSuccessAt: string | null;
	  }
	| {
			readonly kind: "error";
			readonly code: string;
			readonly message: string;
	  };

const CAPABILITY_SET = new Set<FrontendCapability>([
	"clarify",
	"design",
	"escalate",
	"execute",
	"intake",
	"review",
	"triage",
]);
const TASK_STATUS_SET = new Set<FrontendTaskStatus>([
	"queued",
	"claimed",
	"running",
	"done",
	"failed",
	"dead_letter",
	"cancelled",
]);
const SCOPE_KIND_SET = new Set<FrontendScopeKind>(["global", "repo", "worktree"]);
const GATE_STATE_SET = new Set<FrontendGateState>(["clear", "open", "broken"]);
const CONTEXT_KIND_SET = new Set<FrontendContextKind>(["about", "repair"]);

const fail = (message: string): never => {
	throw new Error(message);
};

const expectRecord = (value: unknown, label: string): Record<string, unknown> => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return fail(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
};

const expectString = (value: unknown, label: string): string => {
	if (typeof value !== "string") {
		return fail(`${label} must be a string`);
	}
	return value;
};

const expectNumber = (value: unknown, label: string): number => {
	if (typeof value !== "number") {
		return fail(`${label} must be a number`);
	}
	return value;
};

const expectBoolean = (value: unknown, label: string): boolean => {
	if (typeof value !== "boolean") {
		return fail(`${label} must be a boolean`);
	}
	return value;
};

const expectArray = (value: unknown, label: string): readonly unknown[] => {
	if (!Array.isArray(value)) {
		return fail(`${label} must be an array`);
	}
	return value;
};

const expectNullableString = (value: unknown, label: string): string | null => {
	if (value === null) {
		return null;
	}
	return expectString(value, label);
};

const expectStringArray = (value: unknown, label: string): readonly string[] =>
	expectArray(value, label).map((entry, index) =>
		expectString(entry, `${label}[${String(index)}]`),
	);

const expectCapability = (value: unknown, label: string): FrontendCapability => {
	const parsed = expectString(value, label);
	if (!CAPABILITY_SET.has(parsed as FrontendCapability)) {
		return fail(`${label} has unsupported capability '${parsed}'`);
	}
	return parsed as FrontendCapability;
};

const expectTaskStatus = (value: unknown, label: string): FrontendTaskStatus => {
	const parsed = expectString(value, label);
	if (!TASK_STATUS_SET.has(parsed as FrontendTaskStatus)) {
		return fail(`${label} has unsupported task status '${parsed}'`);
	}
	return parsed as FrontendTaskStatus;
};

const expectScopeKind = (value: unknown, label: string): FrontendScopeKind => {
	const parsed = expectString(value, label);
	if (!SCOPE_KIND_SET.has(parsed as FrontendScopeKind)) {
		return fail(`${label} has unsupported scope kind '${parsed}'`);
	}
	return parsed as FrontendScopeKind;
};

const expectGateState = (value: unknown, label: string): FrontendGateState => {
	const parsed = expectString(value, label);
	if (!GATE_STATE_SET.has(parsed as FrontendGateState)) {
		return fail(`${label} has unsupported gate state '${parsed}'`);
	}
	return parsed as FrontendGateState;
};

const expectContextKind = (value: unknown, label: string): FrontendContextKind => {
	const parsed = expectString(value, label);
	if (!CONTEXT_KIND_SET.has(parsed as FrontendContextKind)) {
		return fail(`${label} has unsupported context kind '${parsed}'`);
	}
	return parsed as FrontendContextKind;
};

const parseSelector = (value: unknown, label: string): ExplorerSelector => {
	const record = expectRecord(value, label);
	const kind = expectString(record.kind, `${label}.kind`);
	switch (kind) {
		case "global":
			return { kind: "global" };
		case "all":
			return { kind: "all" };
		case "scope":
			return {
				kind: "scope",
				scopeId: expectString(record.scopeId, `${label}.scopeId`),
			};
		case "task":
			return {
				kind: "task",
				taskId: expectString(record.taskId, `${label}.taskId`),
			};
		default:
			return fail(`${label}.kind has unsupported selector '${kind}'`);
	}
};

const parseArtifactRef = (value: unknown, label: string): FrontendArtifactRef => {
	const record = expectRecord(value, label);
	return {
		id: expectString(record.id, `${label}.id`),
		kind: expectString(record.kind, `${label}.kind`),
		title: expectString(record.title, `${label}.title`),
	};
};

const parseGraphNode = (value: unknown, label: string): FrontendGraphNode => {
	const record = expectRecord(value, label);
	return {
		id: expectString(record.id, `${label}.id`),
		title: expectString(record.title, `${label}.title`),
		capability: expectCapability(record.capability, `${label}.capability`),
		status: expectTaskStatus(record.status, `${label}.status`),
		scopeId: expectString(record.scope_id, `${label}.scope_id`),
		scopeKind: expectScopeKind(record.scope_kind, `${label}.scope_kind`),
		preview: expectNullableString(record.preview, `${label}.preview`),
		claimable: expectBoolean(record.claimable, `${label}.claimable`),
		unresolvedDependencyIds: expectStringArray(
			record.unresolved_dependency_ids,
			`${label}.unresolved_dependency_ids`,
		),
		artifactRefs: expectArray(record.artifact_refs, `${label}.artifact_refs`).map((entry, index) =>
			parseArtifactRef(entry, `${label}.artifact_refs[${String(index)}]`),
		),
	};
};

const parseGraphEdge = (value: unknown, label: string): FrontendGraphEdge => {
	const record = expectRecord(value, label);
	const kind = expectString(record.kind, `${label}.kind`);
	const base = {
		fromTaskId: expectString(record.from_task_id, `${label}.from_task_id`),
		toTaskId: expectString(record.to_task_id, `${label}.to_task_id`),
	};
	switch (kind) {
		case "after":
		case "about":
		case "repair":
		case "supersedes":
			return { kind, ...base };
		case "gate":
			return {
				kind: "gate",
				...base,
				state: expectGateState(record.state, `${label}.state`),
			};
		default:
			return fail(`${label}.kind has unsupported edge kind '${kind}'`);
	}
};

const parseTaskSummary = (value: unknown, label: string): FrontendTaskSummary => {
	const record = expectRecord(value, label);
	return {
		id: expectString(record.id, `${label}.id`),
		title: expectString(record.title, `${label}.title`),
		capability: expectCapability(record.capability, `${label}.capability`),
		status: expectTaskStatus(record.status, `${label}.status`),
		scopeId: expectString(record.scope_id, `${label}.scope_id`),
		scopeKind: expectScopeKind(record.scope_kind, `${label}.scope_kind`),
	};
};

const parseTaskSourceSummary = (value: unknown, label: string): FrontendTaskSourceSummary => {
	const record = expectRecord(value, label);
	return {
		...parseTaskSummary(record, label),
		sourceKind: expectContextKind(record.source_kind, `${label}.source_kind`),
	};
};

const parseTaskGate = (value: unknown, label: string): FrontendTaskGate => {
	const record = expectRecord(value, label);
	return {
		targetTaskId: expectString(record.target_task_id, `${label}.target_task_id`),
		state: expectGateState(record.state, `${label}.state`),
		members: expectArray(record.members, `${label}.members`).map((entry, index) => {
			const member = expectRecord(entry, `${label}.members[${String(index)}]`);
			return {
				taskId: expectString(member.task_id, `${label}.members[${String(index)}].task_id`),
				canonicalTaskId: expectString(
					member.canonical_task_id,
					`${label}.members[${String(index)}].canonical_task_id`,
				),
				status: expectTaskStatus(member.status, `${label}.members[${String(index)}].status`),
			};
		}),
	};
};

const parseGraphSnapshot = (value: unknown): FrontendGraphSnapshot => {
	const record = expectRecord(value, "graph snapshot");
	if (record.kind !== "graph_snapshot") {
		return fail("graph snapshot kind must be 'graph_snapshot'");
	}
	const outerGraphRecord = expectRecord(record.graph, "graph snapshot graph");
	const graphRecord =
		"graph" in outerGraphRecord
			? expectRecord(outerGraphRecord.graph, "graph snapshot graph.graph")
			: outerGraphRecord;
	return {
		kind: "graph_snapshot",
		selector: parseSelector(record.selector, "graph snapshot selector"),
		generatedAt: expectString(record.generatedAt, "graph snapshot generatedAt"),
		graph: {
			nodes: expectArray(graphRecord.nodes, "graph snapshot nodes").map((entry, index) =>
				parseGraphNode(entry, `graph snapshot nodes[${String(index)}]`),
			),
			edges: expectArray(graphRecord.edges, "graph snapshot edges").map((entry, index) =>
				parseGraphEdge(entry, `graph snapshot edges[${String(index)}]`),
			),
		},
		filters: (() => {
			const filters = expectRecord(record.filters, "graph snapshot filters");
			const since =
				filters.since === undefined
					? undefined
					: (expectNullableString(filters.since, "graph snapshot filters.since") ?? undefined);
			const until =
				filters.until === undefined
					? undefined
					: (expectNullableString(filters.until, "graph snapshot filters.until") ?? undefined);
			return {
				status: expectArray(filters.status, "graph snapshot filters.status").map((entry, index) =>
					expectTaskStatus(entry, `graph snapshot filters.status[${String(index)}]`),
				),
				search: expectStringArray(filters.search, "graph snapshot filters.search"),
				since,
				until,
			};
		})(),
		pithosDbPath: expectString(record.pithosDbPath, "graph snapshot pithosDbPath"),
	};
};

const parseTaskSnapshot = (value: unknown): FrontendTaskSnapshot => {
	const record = expectRecord(value, "task snapshot");
	if (record.kind !== "task_snapshot") {
		return fail("task snapshot kind must be 'task_snapshot'");
	}
	const outerTask = expectRecord(record.task, "task snapshot task record");
	const task = expectRecord(outerTask.task, "task snapshot task");
	return {
		kind: "task_snapshot",
		taskId: expectString(record.taskId, "task snapshot taskId"),
		generatedAt: expectString(record.generatedAt, "task snapshot generatedAt"),
		task: {
			id: expectString(task.id, "task snapshot task.id"),
			title: expectString(task.title, "task snapshot task.title"),
			body: expectString(task.body, "task snapshot task.body"),
			capability: expectCapability(task.capability, "task snapshot task.capability"),
			status: expectTaskStatus(task.status, "task snapshot task.status"),
			scopeId: expectString(task.scope_id, "task snapshot task.scope_id"),
			scopeKind: expectScopeKind(task.scope_kind, "task snapshot task.scope_kind"),
			claimable: expectBoolean(task.claimable, "task snapshot task.claimable"),
			unresolvedDependencyIds: expectStringArray(
				task.unresolved_dependency_ids,
				"task snapshot task.unresolved_dependency_ids",
			),
			gates: expectArray(task.gates, "task snapshot task.gates").map((entry, index) =>
				parseTaskGate(entry, `task snapshot task.gates[${String(index)}]`),
			),
			dependencies: expectArray(outerTask.dependencies, "task snapshot dependencies").map(
				(entry, index) => parseTaskSummary(entry, `task snapshot dependencies[${String(index)}]`),
			),
			dependents: expectArray(outerTask.dependents, "task snapshot dependents").map(
				(entry, index) => parseTaskSummary(entry, `task snapshot dependents[${String(index)}]`),
			),
			artifacts: expectArray(outerTask.artifacts, "task snapshot artifacts").map((entry, index) =>
				parseArtifactRef(entry, `task snapshot artifacts[${String(index)}]`),
			),
		},
		source:
			outerTask.source === null
				? null
				: parseTaskSourceSummary(outerTask.source, "task snapshot source"),
		attachedContext: expectArray(outerTask.attached_context, "task snapshot attached_context").map(
			(entry, index) =>
				parseTaskSourceSummary(entry, `task snapshot attached_context[${String(index)}]`),
		),
		supersedes:
			outerTask.supersedes === null
				? null
				: expectString(outerTask.supersedes, "task snapshot supersedes"),
		supersededBy:
			outerTask.superseded_by === null
				? null
				: expectString(outerTask.superseded_by, "task snapshot superseded_by"),
		pithosDbPath: expectString(record.pithosDbPath, "task snapshot pithosDbPath"),
	};
};

const parseDaemonStatus = (value: unknown): FrontendDaemonStatus => {
	const record = expectRecord(value, "daemon status");
	const status = expectString(record.status, "daemon status.status");
	const base = {
		socketPath: expectString(record.socketPath, "daemon status.socketPath"),
		message: expectString(record.message, "daemon status.message"),
	};
	switch (status) {
		case "running":
			return {
				status: "running",
				...base,
				maxAfk: expectNumber(record.maxAfk, "daemon status.maxAfk"),
				afkUsed: expectNumber(record.afkUsed, "daemon status.afkUsed"),
				registryEntries: expectNumber(record.registryEntries, "daemon status.registryEntries"),
				intakeSocketPath:
					record.intakeSocketPath === null
						? null
						: expectString(record.intakeSocketPath, "daemon status.intakeSocketPath"),
			};
		case "not_running":
			return { status: "not_running", ...base };
		case "unreachable":
			return { status: "unreachable", ...base };
		default:
			return fail(`daemon status.status has unsupported value '${status}'`);
	}
};

export const parseExplorerConfig = (value: unknown): ExplorerConfig => {
	const record = expectRecord(value, "explorer config");
	return {
		host: expectString(record.host, "explorer config.host"),
		port: expectNumber(record.port, "explorer config.port"),
		initialSelector: parseSelector(record.initialSelector, "explorer config.initialSelector"),
		selectorLabel: expectString(record.selectorLabel, "explorer config.selectorLabel"),
		websocketPath: expectString(record.websocketPath, "explorer config.websocketPath"),
	};
};

export const parseGraphWebsocketServerMessage = (value: unknown): GraphWebsocketServerMessage => {
	const record = expectRecord(value, "websocket server message");
	const kind = expectString(record.kind, "websocket server message.kind");
	switch (kind) {
		case "snapshot":
			return {
				kind: "snapshot",
				revision: expectNumber(record.revision, "websocket server message.revision"),
				snapshot: parseGraphSnapshot(record.snapshot),
			};
		case "daemon_status":
			return {
				kind: "daemon_status",
				daemonStatus: parseDaemonStatus(record.daemonStatus),
			};
		case "stale":
			return {
				kind: "stale",
				message: expectString(record.message, "websocket server message.message"),
				lastSuccessAt:
					record.lastSuccessAt === null
						? null
						: expectString(record.lastSuccessAt, "websocket server message.lastSuccessAt"),
			};
		case "error":
			return {
				kind: "error",
				code: expectString(record.code, "websocket server message.code"),
				message: expectString(record.message, "websocket server message.message"),
			};
		default:
			return fail(`websocket server message.kind has unsupported value '${kind}'`);
	}
};

const fetchJson = async (input: RequestInfo | URL): Promise<unknown> => {
	const response = await fetch(input, {
		headers: { accept: "application/json" },
	});
	const bodyText = await response.text();
	if (!response.ok) {
		try {
			const errorBody = expectRecord(JSON.parse(bodyText) as unknown, "explorer error");
			const message = expectString(errorBody.message, "explorer error.message");
			const code = typeof errorBody.code === "string" ? `${errorBody.code}: ` : "";
			throw new Error(`${code}${message}`);
		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error(`Explorer request failed: ${response.status} ${response.statusText}`);
		}
	}
	return JSON.parse(bodyText) as unknown;
};

export const buildGraphRequestQuery = (
	selector: ExplorerSelector,
	timeFilter: TimeFilterSetting,
): string => {
	const params = new URLSearchParams();
	switch (selector.kind) {
		case "global":
			params.set("selector", "global");
			break;
		case "all":
			params.set("selector", "all");
			break;
		case "scope":
			params.set("selector", `scope:${selector.scopeId}`);
			break;
		case "task":
			params.set("selector", `task:${selector.taskId}`);
			break;
	}
	const { since, until } = timeFilterToQueryParameters(timeFilter);
	if (since !== undefined) {
		params.set("since", since);
	}
	if (until !== undefined) {
		params.set("until", until);
	}
	return params.toString();
};

export const buildWebsocketSubscribeMessage = (
	selector: ExplorerSelector,
	timeFilter: TimeFilterSetting,
	lastSuccessAt?: string | null,
): string => {
	const { since, until } = timeFilterToQueryParameters(timeFilter);
	const selectorValue =
		selector.kind === "global"
			? "global"
			: selector.kind === "all"
				? "all"
				: selector.kind === "scope"
					? `scope:${selector.scopeId}`
					: `task:${selector.taskId}`;
	return JSON.stringify({
		kind: "subscribe",
		selector: selectorValue,
		...(since === undefined ? {} : { since }),
		...(until === undefined ? {} : { until }),
		...(lastSuccessAt === undefined || lastSuccessAt === null ? {} : { lastSuccessAt }),
	});
};

export const fetchExplorerConfig = async (): Promise<ExplorerConfig> =>
	parseExplorerConfig(await fetchJson("/api/config"));

export const fetchGraphSnapshot = async (
	selector: ExplorerSelector,
	timeFilter: TimeFilterSetting,
): Promise<FrontendGraphSnapshot> => {
	const query = buildGraphRequestQuery(selector, timeFilter);
	return parseGraphSnapshot(await fetchJson(`/api/graph?${query}`));
};

export const fetchTaskSnapshot = async (taskId: string): Promise<FrontendTaskSnapshot> =>
	parseTaskSnapshot(await fetchJson(`/api/task/${encodeURIComponent(taskId)}`));

export const fetchDaemonStatus = async (): Promise<FrontendDaemonStatus> =>
	parseDaemonStatus(await fetchJson("/api/daemon/status"));
