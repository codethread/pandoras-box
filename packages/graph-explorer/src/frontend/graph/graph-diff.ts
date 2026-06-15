import type { FrontendGraphSnapshot } from "../api.js";

export interface GraphDiff {
	readonly addedNodeIds: readonly string[];
	readonly removedNodeIds: readonly string[];
	readonly changedNodeIds: readonly string[];
	readonly changedEdgeIds: readonly string[];
}

export const emptyGraphDiff: GraphDiff = {
	addedNodeIds: [],
	removedNodeIds: [],
	changedNodeIds: [],
	changedEdgeIds: [],
};

export const graphEdgeId = (edge: FrontendGraphSnapshot["graph"]["edges"][number]): string =>
	edge.kind === "gate"
		? `${edge.kind}:${edge.fromTaskId}->${edge.toTaskId}:${edge.state ?? "unknown"}`
		: `${edge.kind}:${edge.fromTaskId}->${edge.toTaskId}`;

export const diffGraphSnapshots = (
	previousSnapshot: FrontendGraphSnapshot | null,
	nextSnapshot: FrontendGraphSnapshot,
): GraphDiff => {
	if (previousSnapshot === null) {
		return {
			addedNodeIds: nextSnapshot.graph.nodes.map((node) => node.id),
			removedNodeIds: [],
			changedNodeIds: [],
			changedEdgeIds: nextSnapshot.graph.edges.map(graphEdgeId),
		};
	}

	const previousNodes = new Map(
		previousSnapshot.graph.nodes.map((node) => [node.id, node] as const),
	);
	const nextNodes = new Map(nextSnapshot.graph.nodes.map((node) => [node.id, node] as const));
	const previousEdges = new Set(previousSnapshot.graph.edges.map(graphEdgeId));
	const nextEdges = new Set(nextSnapshot.graph.edges.map(graphEdgeId));

	const addedNodeIds = nextSnapshot.graph.nodes
		.map((node) => node.id)
		.filter((id) => !previousNodes.has(id));
	const removedNodeIds = previousSnapshot.graph.nodes
		.map((node) => node.id)
		.filter((id) => !nextNodes.has(id));
	const changedNodeIds = nextSnapshot.graph.nodes
		.filter((node) => {
			const previous = previousNodes.get(node.id);
			return (
				previous !== undefined &&
				(previous.status !== node.status ||
					previous.claimable !== node.claimable ||
					previous.preview !== node.preview)
			);
		})
		.map((node) => node.id);
	const changedEdgeIds = nextSnapshot.graph.edges
		.map(graphEdgeId)
		.filter((id) => !previousEdges.has(id));
	for (const previousEdgeId of previousEdges) {
		if (!nextEdges.has(previousEdgeId)) {
			changedEdgeIds.push(previousEdgeId);
		}
	}

	return {
		addedNodeIds,
		removedNodeIds,
		changedNodeIds,
		changedEdgeIds,
	};
};
