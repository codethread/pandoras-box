import type { FrontendGraphSnapshot } from "../api.js";
import { graphEdgeId, type GraphDiff } from "./graph-diff.js";
import type { LayoutPosition, LayoutRequest, LayoutResult } from "./layout-types.js";

export interface NodePosition {
	readonly x: number;
	readonly y: number;
}

export type NodePositionMap = ReadonlyMap<string, NodePosition>;

const NODE_WIDTH_MIN = 220;
const NODE_WIDTH_MAX = 360;
const NODE_HEIGHT = 56;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

// In the LR layout the node width is the per-depth column footprint and the
// label renders to the node's right, so reserve room for the title to keep it
// from running into the next depth column at default zoom.
const estimateNodeWidth = (title: string): number =>
	clamp(title.length * 8 + 120, NODE_WIDTH_MIN, NODE_WIDTH_MAX);

export const buildLayoutRequest = (
	snapshot: FrontendGraphSnapshot,
	requestId: number,
): LayoutRequest => ({
	requestId,
	// LR lays each tree out as its own horizontal band that branches rightward as
	// depth grows; disconnected trees stack into separate rows.
	rankDirection: "LR",
	nodes: snapshot.graph.nodes.map((node) => ({
		id: node.id,
		width: estimateNodeWidth(node.title),
		height: NODE_HEIGHT,
	})),
	edges: snapshot.graph.edges.map((edge) => ({
		id: graphEdgeId(edge),
		fromTaskId: edge.fromTaskId,
		toTaskId: edge.toTaskId,
		kind: edge.kind,
	})),
});

export const nodePositionsFromLayoutResult = (
	result: LayoutResult,
): ReadonlyMap<string, NodePosition> =>
	new Map(result.positions.map((position) => [position.id, position] as const));

export const hasCompleteNodePositions = (
	snapshot: FrontendGraphSnapshot,
	positions: NodePositionMap,
): boolean => snapshot.graph.nodes.every((node) => positions.has(node.id));

export const shouldRelayoutGraph = (
	snapshot: FrontendGraphSnapshot,
	diff: GraphDiff,
	positions: NodePositionMap,
): boolean => {
	if (!hasCompleteNodePositions(snapshot, positions)) {
		return true;
	}
	if (diff.addedNodeIds.length > 0 || diff.removedNodeIds.length > 0) {
		return true;
	}
	return diff.changedEdgeIds.length > 0;
};

export const nodePositionEntries = (positions: NodePositionMap): readonly LayoutPosition[] =>
	Array.from(positions.entries()).map(([id, position]) => ({ id, ...position }));
