import type { FrontendCapability, FrontendGraphSnapshot, FrontendTaskStatus } from "../api.js";

const STATUS_ORDER: readonly FrontendTaskStatus[] = [
	"running",
	"claimed",
	"queued",
	"failed",
	"cancelled",
	"dead_letter",
	"done",
];
const STATUS_RANK = new Map(STATUS_ORDER.map((status, index) => [status, index] as const));

export interface GraphViewTask {
	readonly id: string;
	readonly title: string;
	readonly capability: FrontendCapability;
	readonly status: FrontendTaskStatus;
	readonly scopeId: string;
	readonly preview: string | null;
	readonly claimable: boolean;
	readonly unresolvedDependencyCount: number;
	readonly artifactCount: number;
	readonly isSelected: boolean;
}

export interface GraphViewModel {
	readonly nodeCount: number;
	readonly edgeCount: number;
	readonly selectedTaskId: string | null;
	readonly tasks: readonly GraphViewTask[];
	readonly statusCounts: ReadonlyMap<string, number>;
	readonly capabilityCounts: ReadonlyMap<string, number>;
	readonly edgeCounts: ReadonlyMap<string, number>;
}

const increment = (map: Map<string, number>, key: string): void => {
	map.set(key, (map.get(key) ?? 0) + 1);
};

export const buildGraphViewModel = (
	snapshot: FrontendGraphSnapshot,
	selectedTaskId: string | null,
): GraphViewModel => {
	const statusCounts = new Map<string, number>();
	const capabilityCounts = new Map<string, number>();
	const edgeCounts = new Map<string, number>();

	const tasks = snapshot.graph.nodes
		.map((node) => {
			increment(statusCounts, node.claimable ? "claimable" : node.status);
			increment(capabilityCounts, node.capability);
			return {
				id: node.id,
				title: node.title,
				capability: node.capability,
				status: node.status,
				scopeId: node.scopeId,
				preview: node.preview,
				claimable: node.claimable,
				unresolvedDependencyCount: node.unresolvedDependencyIds.length,
				artifactCount: node.artifactRefs.length,
				isSelected: node.id === selectedTaskId,
			} satisfies GraphViewTask;
		})
		.sort((left, right) => {
			const leftRank = STATUS_RANK.get(left.status) ?? Number.MAX_SAFE_INTEGER;
			const rightRank = STATUS_RANK.get(right.status) ?? Number.MAX_SAFE_INTEGER;
			if (leftRank !== rightRank) {
				return leftRank - rightRank;
			}
			if (left.claimable !== right.claimable) {
				return left.claimable ? -1 : 1;
			}
			return left.title.localeCompare(right.title);
		});

	for (const edge of snapshot.graph.edges) {
		increment(edgeCounts, edge.kind === "gate" ? `gate:${edge.state ?? "unknown"}` : edge.kind);
	}

	return {
		nodeCount: snapshot.graph.nodes.length,
		edgeCount: snapshot.graph.edges.length,
		selectedTaskId,
		tasks,
		statusCounts,
		capabilityCounts,
		edgeCounts,
	};
};
