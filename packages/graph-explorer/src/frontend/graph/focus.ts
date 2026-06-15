import type { FrontendGateState, FrontendGraphSnapshot } from "../api.js";
import { isBrokenTaskStatus } from "./visual-style.js";
import { graphEdgeId } from "./graph-diff.js";

export interface GraphFocus {
	readonly selectedTaskId: string | null;
	readonly branchNodeIds: ReadonlySet<string>;
	readonly dependencyNodeIds: ReadonlySet<string>;
	readonly dependentNodeIds: ReadonlySet<string>;
	readonly gateNodeIds: ReadonlySet<string>;
	readonly brokenNodeIds: ReadonlySet<string>;
	readonly gateNodeStates: ReadonlyMap<string, FrontendGateState>;
	readonly highlightedNodeIds: ReadonlySet<string>;
	readonly highlightedEdgeIds: ReadonlySet<string>;
}

const BRANCH_EDGE_KINDS = new Set<FrontendGraphSnapshot["graph"]["edges"][number]["kind"]>([
	"after",
	"about",
	"repair",
]);

const emptyFocus = (): GraphFocus => ({
	selectedTaskId: null,
	branchNodeIds: new Set(),
	dependencyNodeIds: new Set(),
	dependentNodeIds: new Set(),
	gateNodeIds: new Set(),
	brokenNodeIds: new Set(),
	gateNodeStates: new Map(),
	highlightedNodeIds: new Set(),
	highlightedEdgeIds: new Set(),
});

const gateStateRank: Record<FrontendGateState, number> = {
	broken: 3,
	open: 2,
	clear: 1,
};

const mergeGateNodeState = (
	map: Map<string, FrontendGateState>,
	taskId: string,
	state: FrontendGateState,
): void => {
	const current = map.get(taskId);
	if (current === undefined || gateStateRank[state] > gateStateRank[current]) {
		map.set(taskId, state);
	}
};

export const buildGraphFocus = (
	snapshot: FrontendGraphSnapshot,
	selectedTaskId: string | null,
): GraphFocus => {
	if (selectedTaskId === null) {
		return emptyFocus();
	}

	const branchNodeIds = new Set<string>([selectedTaskId]);
	const dependencyNodeIds = new Set<string>();
	const dependentNodeIds = new Set<string>();
	const gateNodeIds = new Set<string>();
	const brokenNodeIds = new Set<string>();
	const gateNodeStates = new Map<string, FrontendGateState>();
	const highlightedEdgeIds = new Set<string>();

	const incomingBranchOwners = new Map<string, string[]>();
	for (const edge of snapshot.graph.edges) {
		if (!BRANCH_EDGE_KINDS.has(edge.kind)) {
			continue;
		}
		const owners = incomingBranchOwners.get(edge.toTaskId) ?? [];
		owners.push(edge.fromTaskId);
		incomingBranchOwners.set(edge.toTaskId, owners);
	}

	const queue = [selectedTaskId];
	while (queue.length > 0) {
		const currentTaskId = queue.shift();
		if (currentTaskId === undefined) {
			continue;
		}
		for (const ownerTaskId of incomingBranchOwners.get(currentTaskId) ?? []) {
			if (branchNodeIds.has(ownerTaskId)) {
				continue;
			}
			branchNodeIds.add(ownerTaskId);
			queue.push(ownerTaskId);
		}
	}

	for (const edge of snapshot.graph.edges) {
		const edgeId = graphEdgeId(edge);
		if (branchNodeIds.has(edge.fromTaskId) && branchNodeIds.has(edge.toTaskId)) {
			highlightedEdgeIds.add(edgeId);
		}
		if (edge.fromTaskId === selectedTaskId) {
			dependencyNodeIds.add(edge.toTaskId);
			highlightedEdgeIds.add(edgeId);
			if (edge.kind === "gate") {
				gateNodeIds.add(edge.toTaskId);
				mergeGateNodeState(gateNodeStates, edge.toTaskId, edge.state ?? "open");
			}
		}
		if (edge.toTaskId === selectedTaskId) {
			dependentNodeIds.add(edge.fromTaskId);
			highlightedEdgeIds.add(edgeId);
			if (edge.kind === "gate") {
				gateNodeIds.add(edge.fromTaskId);
				mergeGateNodeState(gateNodeStates, edge.fromTaskId, edge.state ?? "open");
			}
		}
	}

	const highlightedNodeIds = new Set<string>([
		...branchNodeIds,
		...dependencyNodeIds,
		...dependentNodeIds,
		...gateNodeIds,
	]);

	for (const node of snapshot.graph.nodes) {
		if (!highlightedNodeIds.has(node.id)) {
			continue;
		}
		if (isBrokenTaskStatus(node.status)) {
			brokenNodeIds.add(node.id);
		}
	}

	for (const [taskId, state] of gateNodeStates) {
		if (state === "broken") {
			brokenNodeIds.add(taskId);
		}
	}

	return {
		selectedTaskId,
		branchNodeIds,
		dependencyNodeIds,
		dependentNodeIds,
		gateNodeIds,
		brokenNodeIds,
		gateNodeStates,
		highlightedNodeIds,
		highlightedEdgeIds,
	};
};
