/// <reference lib="webworker" />

import { graphlib, layout } from "@dagrejs/dagre";

import type { LayoutRequest, LayoutResult, LayoutWorkerMessage } from "./layout-types.js";

const fail = (message: string): never => {
	throw new Error(message);
};

const assertLayoutRequest = (value: unknown): LayoutRequest => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return fail("Layout request must be an object.");
	}
	const record = value as Record<string, unknown>;
	if (typeof record.requestId !== "number") {
		return fail("Layout requestId must be a number.");
	}
	if (record.rankDirection !== "TB" && record.rankDirection !== "LR") {
		return fail("Layout rankDirection must be 'TB' or 'LR'.");
	}
	if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) {
		return fail("Layout request nodes and edges must be arrays.");
	}

	return {
		requestId: record.requestId,
		rankDirection: record.rankDirection,
		nodes: record.nodes.map((entry, index) => {
			if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
				return fail(`Layout node ${String(index)} must be an object.`);
			}
			const node = entry as Record<string, unknown>;
			if (
				typeof node.id !== "string" ||
				typeof node.width !== "number" ||
				typeof node.height !== "number"
			) {
				return fail(`Layout node ${String(index)} is invalid.`);
			}
			return {
				id: node.id,
				width: node.width,
				height: node.height,
			};
		}),
		edges: record.edges.map((entry, index) => {
			if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
				return fail(`Layout edge ${String(index)} must be an object.`);
			}
			const edge = entry as Record<string, unknown>;
			if (
				typeof edge.id !== "string" ||
				typeof edge.fromTaskId !== "string" ||
				typeof edge.toTaskId !== "string" ||
				typeof edge.kind !== "string"
			) {
				return fail(`Layout edge ${String(index)} is invalid.`);
			}
			return {
				id: edge.id,
				fromTaskId: edge.fromTaskId,
				toTaskId: edge.toTaskId,
				kind: edge.kind,
			};
		}),
	};
};

export const computeDagreLayout = (request: LayoutRequest): LayoutResult => {
	const dagreGraph: graphlib.Graph = new graphlib.Graph({ multigraph: true, directed: true });
	dagreGraph.setGraph({
		rankdir: request.rankDirection,
		// LR: nodesep is the vertical gap between sibling nodes and between
		// separate trees; ranksep is the horizontal gap between depth columns.
		nodesep: 72,
		ranksep: 120,
		edgesep: 24,
		marginx: 32,
		marginy: 32,
	});
	dagreGraph.setDefaultEdgeLabel(() => ({}));

	for (const node of request.nodes) {
		dagreGraph.setNode(node.id, {
			width: node.width,
			height: node.height,
		});
	}

	for (const edge of request.edges) {
		dagreGraph.setEdge(
			{ v: edge.fromTaskId, w: edge.toTaskId, name: edge.id },
			{ minlen: edge.kind === "gate" ? 2 : 1, weight: edge.kind === "after" ? 3 : 1 },
		);
	}

	layout(dagreGraph as Parameters<typeof layout>[0]);

	const graphDimensions = dagreGraph.graph() as {
		readonly width?: number;
		readonly height?: number;
	};

	return {
		requestId: request.requestId,
		positions: request.nodes.map((node) => {
			const positionedNode = dagreGraph.node(node.id) as
				| {
						readonly x?: number;
						readonly y?: number;
				  }
				| undefined;
			if (
				positionedNode === undefined ||
				typeof positionedNode.x !== "number" ||
				typeof positionedNode.y !== "number"
			) {
				return fail(`Layout result missing coordinates for node '${node.id}'.`);
			}
			return {
				id: node.id,
				x: positionedNode.x,
				y: positionedNode.y,
			};
		}),
		width: typeof graphDimensions.width === "number" ? graphDimensions.width : 0,
		height: typeof graphDimensions.height === "number" ? graphDimensions.height : 0,
	};
};

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
	let requestId = -1;
	try {
		const request = assertLayoutRequest(event.data);
		requestId = request.requestId;
		const message: LayoutWorkerMessage = {
			kind: "layout_result",
			result: computeDagreLayout(request),
		};
		workerScope.postMessage(message);
	} catch (error) {
		const message: LayoutWorkerMessage = {
			kind: "layout_error",
			requestId,
			message: error instanceof Error ? error.message : String(error),
		};
		workerScope.postMessage(message);
	}
});
