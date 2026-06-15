import { describe, expect, it } from "vitest";

import {
	buildGraphRequestQuery,
	buildWebsocketSubscribeMessage,
	parseExplorerConfig,
	parseGraphWebsocketServerMessage,
	type FrontendGraphSnapshot,
} from "../src/frontend/api.js";
import { buildGraphFocus } from "../src/frontend/graph/focus.js";
import { diffGraphSnapshots } from "../src/frontend/graph/graph-diff.js";
import { shouldRelayoutGraph } from "../src/frontend/graph/layout-adapter.js";
import { parseExplorerRoute, pathForSelector } from "../src/frontend/routes.js";
import {
	defaultSettingsState,
	parseStoredSettings,
	timeFilterRequestValidationMessage,
	timeFilterToQueryParameters,
	updateScopeId,
	updateScopeViewMode,
} from "../src/frontend/stores/settings-store.js";
import { computeFreshnessState } from "../src/frontend/stores/websocket-store.js";

const makeSnapshot = (
	input: Partial<FrontendGraphSnapshot> & {
		readonly nodes?: FrontendGraphSnapshot["graph"]["nodes"];
		readonly edges?: FrontendGraphSnapshot["graph"]["edges"];
	},
): FrontendGraphSnapshot => ({
	kind: "graph_snapshot",
	selector: input.selector ?? { kind: "global" },
	generatedAt: input.generatedAt ?? "2026-06-14T12:00:00.000Z",
	graph: {
		nodes: input.nodes ?? [
			{
				id: "task_alpha",
				title: "Alpha",
				capability: "execute",
				status: "queued",
				scopeId: "global",
				scopeKind: "global",
				preview: "Alpha preview",
				claimable: true,
				unresolvedDependencyIds: [],
				artifactRefs: [],
			},
		],
		edges: input.edges ?? [
			{
				kind: "after",
				fromTaskId: "task_alpha",
				toTaskId: "task_root",
			},
		],
	},
	filters: input.filters ?? { status: [], search: [], since: undefined, until: undefined },
	pithosDbPath: input.pithosDbPath ?? "/tmp/pithos.sqlite",
});

describe("frontend settings helpers", () => {
	it("recovers invalid persisted settings to defaults", () => {
		const result = parseStoredSettings(
			JSON.stringify({
				version: 1,
				scopeView: { kind: "scope" },
				refreshIntervalSeconds: 999,
				timeFilter: { kind: "relative", value: "bogus" },
			}),
		);

		expect(result.recovered).toBe(true);
		expect(result.settings).toEqual(defaultSettingsState);
		expect(result.message).toMatch(/reset/i);
	});

	it("recovers invalid persisted absolute ranges to defaults", () => {
		const result = parseStoredSettings(
			JSON.stringify({
				version: 2,
				scopeView: { kind: "global" },
				refreshIntervalSeconds: 30,
				timeFilter: { kind: "absolute", sinceLocal: "", untilLocal: "2026-06-14T09:45" },
			}),
		);

		expect(result.recovered).toBe(true);
		expect(result.settings.timeFilter).toEqual({ kind: "off" });
	});

	it("builds bounded absolute query parameters for persisted timestamps", () => {
		const params = timeFilterToQueryParameters({
			kind: "absolute",
			sinceLocal: "2026-06-14T08:30",
			untilLocal: "2026-06-14T09:45",
		});
		expect(params.since).toMatch(/^2026-06-14T/);
		expect(params.until).toMatch(/^2026-06-14T/);
		expect(
			timeFilterToQueryParameters({ kind: "absolute", sinceLocal: "", untilLocal: "" }),
		).toEqual({ since: undefined, until: undefined });
		expect(
			timeFilterRequestValidationMessage({ kind: "absolute", sinceLocal: "", untilLocal: "" }),
		).toMatch(/requires both start and end/i);
	});

	it("preserves custom scope ids when switching into scope mode", () => {
		const scoped = updateScopeId(updateScopeViewMode(defaultSettingsState, "scope"), "repo:/work");
		expect(scoped.scopeView).toEqual({ kind: "scope", scopeId: "repo:/work" });
	});
});

describe("frontend routing and query helpers", () => {
	it("parses task and scope routes and formats selector paths", () => {
		expect(parseExplorerRoute("/task/task_alpha")).toEqual({
			kind: "task",
			selectorOverride: { kind: "task", taskId: "task_alpha" },
			selectedTaskId: "task_alpha",
		});
		expect(parseExplorerRoute("/scope/repo%3A%2Fworktree")).toEqual({
			kind: "selector",
			selectorOverride: { kind: "scope", scopeId: "repo:/worktree" },
			selectedTaskId: null,
		});
		expect(pathForSelector({ kind: "scope", scopeId: "repo:/worktree" })).toBe(
			"/scope/repo%3A%2Fworktree",
		);
	});

	it("builds graph request and websocket subscribe payloads from selector and time filter", () => {
		expect(
			buildGraphRequestQuery(
				{ kind: "scope", scopeId: "repo:/work" },
				{ kind: "relative", value: "1h" },
			),
		).toBe("selector=scope%3Arepo%3A%2Fwork&since=1h");
		expect(
			buildGraphRequestQuery(
				{ kind: "global" },
				{
					kind: "absolute",
					sinceLocal: "2026-06-14T08:30",
					untilLocal: "2026-06-14T09:45",
				},
			),
		).toContain("until=");
		expect(
			JSON.parse(
				buildWebsocketSubscribeMessage({ kind: "all" }, { kind: "relative", value: "30m" }),
			) as unknown,
		).toEqual({ kind: "subscribe", selector: "all", since: "30m" });
		const absoluteSubscribe = JSON.parse(
			buildWebsocketSubscribeMessage(
				{ kind: "global" },
				{
					kind: "absolute",
					sinceLocal: "2026-06-14T08:30",
					untilLocal: "2026-06-14T09:45",
				},
			),
		) as { kind: string; selector: string; since?: string; until?: string };
		expect(absoluteSubscribe.kind).toBe("subscribe");
		expect(absoluteSubscribe.selector).toBe("global");
		expect(absoluteSubscribe.since).toEqual(expect.any(String));
		expect(absoluteSubscribe.until).toEqual(expect.any(String));
	});
});

describe("frontend parsing and freshness helpers", () => {
	it("parses explorer config and websocket snapshot messages at the browser boundary", () => {
		expect(
			parseExplorerConfig({
				host: "127.0.0.1",
				port: 4312,
				initialSelector: { kind: "global" },
				selectorLabel: "global",
				websocketPath: "/ws/graph",
			}),
		).toEqual({
			host: "127.0.0.1",
			port: 4312,
			initialSelector: { kind: "global" },
			selectorLabel: "global",
			websocketPath: "/ws/graph",
		});

		const message = parseGraphWebsocketServerMessage({
			kind: "snapshot",
			revision: 2,
			snapshot: {
				kind: "graph_snapshot",
				selector: { kind: "global" },
				generatedAt: "2026-06-14T12:00:00.000Z",
				graph: {
					ok: true,
					graph: {
						selector: { kind: "scope", value: "global" },
						nodes: [
							{
								id: "task_alpha",
								title: "Alpha",
								capability: "execute",
								status: "queued",
								scope_id: "global",
								scope_kind: "global",
								preview: "Alpha preview",
								claimable: true,
								unresolved_dependency_ids: [],
								artifact_refs: [],
							},
						],
						edges: [
							{
								kind: "after",
								from_task_id: "task_alpha",
								to_task_id: "task_root",
							},
						],
						late_growth_markers: [],
					},
				},
				filters: { status: [], search: [], since: undefined, until: undefined },
				pithosDbPath: "/tmp/pithos.sqlite",
			},
		});
		expect(message.kind).toBe("snapshot");
		const snapshotMessage = message as Extract<typeof message, { kind: "snapshot" }>;
		expect(snapshotMessage.snapshot.graph.nodes[0]?.id).toBe("task_alpha");
		expect(
			parseGraphWebsocketServerMessage({
				kind: "stale",
				message: "Graph snapshot refresh failed: db unavailable",
				lastSuccessAt: "2026-06-14T11:58:00.000Z",
			}),
		).toEqual({
			kind: "stale",
			message: "Graph snapshot refresh failed: db unavailable",
			lastSuccessAt: "2026-06-14T11:58:00.000Z",
		});
	});

	it("marks stale snapshots when the refresh window is exceeded", () => {
		expect(computeFreshnessState(null, "2026-06-14T12:00:00.000Z", 30).status).toBe("empty");
		expect(
			computeFreshnessState("2026-06-14T11:58:30.000Z", "2026-06-14T12:00:00.000Z", 30).status,
		).toBe("stale");
	});
});

describe("graph diffing and layout decisions", () => {
	it("tracks added, removed, and changed nodes and edges by stable ids", () => {
		const previous = makeSnapshot({});
		const next = makeSnapshot({
			nodes: [
				{
					id: "task_alpha",
					title: "Alpha",
					capability: "execute",
					status: "running",
					scopeId: "global",
					scopeKind: "global",
					preview: "Changed preview",
					claimable: false,
					unresolvedDependencyIds: [],
					artifactRefs: [],
				},
				{
					id: "task_beta",
					title: "Beta",
					capability: "design",
					status: "queued",
					scopeId: "global",
					scopeKind: "global",
					preview: null,
					claimable: false,
					unresolvedDependencyIds: [],
					artifactRefs: [],
				},
			],
			edges: [
				{
					kind: "gate",
					fromTaskId: "task_beta",
					toTaskId: "task_alpha",
					state: "open",
				},
			],
		});

		const diff = diffGraphSnapshots(previous, next);
		expect(diff.addedNodeIds).toEqual(["task_beta"]);
		expect(diff.removedNodeIds).toEqual([]);
		expect(diff.changedNodeIds).toEqual(["task_alpha"]);
		expect(diff.changedEdgeIds).toEqual([
			"gate:task_beta->task_alpha:open",
			"after:task_alpha->task_root",
		]);
	});

	it("reuses layout positions when only task status changes", () => {
		const snapshot = makeSnapshot({
			nodes: [
				{
					id: "task_alpha",
					title: "Alpha",
					capability: "execute",
					status: "running",
					scopeId: "global",
					scopeKind: "global",
					preview: "Changed preview",
					claimable: false,
					unresolvedDependencyIds: [],
					artifactRefs: [],
				},
			],
		});
		const diff = {
			addedNodeIds: [],
			removedNodeIds: [],
			changedNodeIds: ["task_alpha"],
			changedEdgeIds: [],
		} as const;

		expect(shouldRelayoutGraph(snapshot, diff, new Map([["task_alpha", { x: 10, y: 12 }]]))).toBe(
			false,
		);
		expect(
			shouldRelayoutGraph(
				snapshot,
				{ ...diff, changedEdgeIds: ["after:task_alpha->task_root"] },
				new Map([["task_alpha", { x: 10, y: 12 }]]),
			),
		).toBe(true);
	});
});

describe("graph branch focus", () => {
	it("highlights branch members, dependencies, and gate relationships around the selection", () => {
		const snapshot = makeSnapshot({
			nodes: [
				{
					id: "task_root",
					title: "Root",
					capability: "triage",
					status: "queued",
					scopeId: "global",
					scopeKind: "global",
					preview: null,
					claimable: false,
					unresolvedDependencyIds: [],
					artifactRefs: [],
				},
				{
					id: "task_execute",
					title: "Execute",
					capability: "execute",
					status: "queued",
					scopeId: "global",
					scopeKind: "global",
					preview: null,
					claimable: false,
					unresolvedDependencyIds: [],
					artifactRefs: [],
				},
				{
					id: "task_context",
					title: "Context",
					capability: "escalate",
					status: "done",
					scopeId: "global",
					scopeKind: "global",
					preview: null,
					claimable: false,
					unresolvedDependencyIds: [],
					artifactRefs: [],
				},
				{
					id: "task_gate",
					title: "Gate",
					capability: "review",
					status: "queued",
					scopeId: "global",
					scopeKind: "global",
					preview: null,
					claimable: false,
					unresolvedDependencyIds: [],
					artifactRefs: [],
				},
				{
					id: "task_dependency",
					title: "Dependency",
					capability: "design",
					status: "done",
					scopeId: "global",
					scopeKind: "global",
					preview: null,
					claimable: false,
					unresolvedDependencyIds: [],
					artifactRefs: [],
				},
			],
			edges: [
				{ kind: "after", fromTaskId: "task_execute", toTaskId: "task_root" },
				{ kind: "about", fromTaskId: "task_context", toTaskId: "task_root" },
				{ kind: "gate", fromTaskId: "task_gate", toTaskId: "task_root", state: "open" },
				{ kind: "after", fromTaskId: "task_root", toTaskId: "task_dependency" },
			],
		});

		const focus = buildGraphFocus(snapshot, "task_root");
		expect(Array.from(focus.branchNodeIds).sort()).toEqual([
			"task_context",
			"task_execute",
			"task_root",
		]);
		expect(Array.from(focus.dependencyNodeIds)).toEqual(["task_dependency"]);
		expect(Array.from(focus.gateNodeIds)).toEqual(["task_gate"]);
		expect(focus.gateNodeStates.get("task_gate")).toBe("open");
		expect(Array.from(focus.brokenNodeIds)).toEqual([]);
		expect(Array.from(focus.highlightedEdgeIds).sort()).toEqual([
			"about:task_context->task_root",
			"after:task_execute->task_root",
			"after:task_root->task_dependency",
			"gate:task_gate->task_root:open",
		]);
	});

	it("marks broken checkpoint branches so the focused canvas can accent them", () => {
		const snapshot = makeSnapshot({
			nodes: [
				{
					id: "task_root",
					title: "Root",
					capability: "triage",
					status: "queued",
					scopeId: "global",
					scopeKind: "global",
					preview: null,
					claimable: false,
					unresolvedDependencyIds: [],
					artifactRefs: [],
				},
				{
					id: "task_gate",
					title: "Gate",
					capability: "review",
					status: "queued",
					scopeId: "global",
					scopeKind: "global",
					preview: null,
					claimable: false,
					unresolvedDependencyIds: [],
					artifactRefs: [],
				},
			],
			edges: [{ kind: "gate", fromTaskId: "task_gate", toTaskId: "task_root", state: "broken" }],
		});

		const focus = buildGraphFocus(snapshot, "task_root");
		expect(focus.gateNodeStates.get("task_gate")).toBe("broken");
		expect(Array.from(focus.brokenNodeIds)).toEqual(["task_gate"]);
	});
});
