import { MultiDirectedGraph } from "graphology";
import Sigma from "sigma";
import {
	EdgeArrowProgram,
	type EdgeProgramType,
	type NodeHoverDrawingFunction,
	type NodeLabelDrawingFunction,
} from "sigma/rendering";
import EdgeCurveProgram, { EdgeCurvedArrowProgram } from "@sigma/edge-curve";

import type { FrontendGraphSnapshot } from "../api.js";
import { escapeHtml } from "../lib/utils.js";
import {
	buildLayoutRequest,
	nodePositionsFromLayoutResult,
	shouldRelayoutGraph,
} from "./layout-adapter.js";
import { buildGraphFocus } from "./focus.js";
import { graphEdgeId, type GraphDiff } from "./graph-diff.js";
import type { LayoutRequest, LayoutResult, LayoutWorkerMessage } from "./layout-types.js";
import {
	capabilityBadgeStyles,
	edgeColorForGraphEdge,
	edgeKindStyles,
	gateNodeColor,
	graphVisualStyle,
	visualStateForTask,
} from "./visual-style.js";

interface GraphCanvasModel {
	readonly host: HTMLElement;
	readonly snapshot: FrontendGraphSnapshot | null;
	readonly graphDiff: GraphDiff;
	readonly selectedTaskId: string | null;
}

interface SigmaNodeAttributes {
	readonly label: string;
	readonly color: string;
	readonly x: number;
	readonly y: number;
	readonly size: number;
	readonly type: string;
	readonly hidden: boolean;
	readonly forceLabel: boolean;
	readonly zIndex: number;
	readonly highlighted: boolean;
	readonly originalColor: string;
}

interface SigmaEdgeAttributes {
	readonly label: string | null;
	readonly color: string;
	readonly size: number;
	readonly type: string;
	readonly hidden: boolean;
	readonly forceLabel: boolean;
	readonly zIndex: number;
	readonly originalColor: string;
	readonly curvature?: number;
}

const nodeSizeForVisualState = (visualState: ReturnType<typeof visualStateForTask>): number => {
	switch (visualState) {
		case "claimable":
			return 9;
		case "running":
			return 8.5;
		case "done":
			return 6.5;
		case "broken":
			return 7.5;
		case "queued":
			return 6;
	}
};

// Grow hubs with their connection count so busy tasks read as anchors without
// the discs ballooning into the overlapping bar we had before.
const nodeSizeWithDegree = (baseSize: number, degree: number): number =>
	baseSize + Math.min(degree, 8) * 0.7;

const edgeLabelForSnapshotEdge = (
	edge: FrontendGraphSnapshot["graph"]["edges"][number],
): string | null => {
	if (edge.kind === "gate") {
		return `gate:${edge.state ?? "open"}`;
	}
	return edge.kind === "after" ? null : edge.kind;
};

const NODE_LABEL_FILL = "#e2e9f6";
const NODE_LABEL_HOVER_FILL = "#ffffff";
// Dark halo so a label stays readable over the dark canvas and over any node it
// crosses; replaces Sigma's default white hover pill that hid our light text.
const NODE_LABEL_HALO = "rgba(5, 11, 20, 0.92)";
const NODE_LABEL_GAP = 5;

// Render the node title centred below the disc (Obsidian-style) with a dark
// halo instead of Sigma's default right-aligned, white-boxed label.
const drawNodeLabelBelow: NodeLabelDrawingFunction<SigmaNodeAttributes, SigmaEdgeAttributes> = (
	context,
	data,
	settings,
) => {
	if (typeof data.label !== "string" || data.label.length === 0) {
		return;
	}
	const fontSize = settings.labelSize;
	context.font = `${settings.labelWeight} ${String(fontSize)}px ${settings.labelFont}`;
	context.textAlign = "center";
	context.textBaseline = "top";
	const x = data.x;
	const y = data.y + data.size + NODE_LABEL_GAP;
	context.lineWidth = 3;
	context.lineJoin = "round";
	context.strokeStyle = NODE_LABEL_HALO;
	context.strokeText(data.label, x, y);
	context.fillStyle = NODE_LABEL_FILL;
	context.fillText(data.label, x, y);
	context.textAlign = "left";
	context.textBaseline = "alphabetic";
};

const drawNodeHoverBelow: NodeHoverDrawingFunction<SigmaNodeAttributes, SigmaEdgeAttributes> = (
	context,
	data,
	settings,
) => {
	if (typeof data.label !== "string" || data.label.length === 0) {
		return;
	}
	const fontSize = settings.labelSize;
	context.font = `${settings.labelWeight} ${String(fontSize)}px ${settings.labelFont}`;
	context.textAlign = "center";
	context.textBaseline = "top";
	const x = data.x;
	const y = data.y + data.size + NODE_LABEL_GAP;
	context.lineWidth = 4;
	context.lineJoin = "round";
	context.strokeStyle = NODE_LABEL_HALO;
	context.strokeText(data.label, x, y);
	context.fillStyle = NODE_LABEL_HOVER_FILL;
	context.fillText(data.label, x, y);
	context.textAlign = "left";
	context.textBaseline = "alphabetic";
};

const renderMessage = (tone: "info" | "error", message: string): string =>
	`<div class="graph-canvas__message graph-canvas__message--${tone}">${escapeHtml(message)}</div>`;

const parallelCurvature = (index: number, count: number): number => {
	if (count <= 1) {
		return 0.22;
	}
	const midpoint = (count - 1) / 2;
	return (index - midpoint) * 0.32;
};

const buildSigmaGraph = (
	snapshot: FrontendGraphSnapshot,
	selectedTaskId: string | null,
	positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
): MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes> => {
	const graph = new MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes>();

	for (const node of snapshot.graph.nodes) {
		const position = positions.get(node.id);
		if (position === undefined) {
			throw new Error(`Missing layout coordinates for task '${node.id}'.`);
		}
		const capabilityBadge = capabilityBadgeStyles[node.capability];
		const visualState = visualStateForTask(node);
		const statusStyle = graphVisualStyle.nodeStates[visualState];
		graph.addNode(node.id, {
			label: `${capabilityBadge.glyph} ${node.title}`,
			color: statusStyle.fill,
			originalColor: statusStyle.fill,
			x: position.x,
			y: position.y,
			size: nodeSizeForVisualState(visualState),
			type: "circle",
			hidden: false,
			forceLabel: node.id === selectedTaskId,
			zIndex: node.id === selectedTaskId ? 40 : 5,
			highlighted: node.id === selectedTaskId,
		});
	}

	const curvedEdgeGroups = new Map<string, string[]>();
	for (const edge of snapshot.graph.edges) {
		const style = edgeKindStyles[edge.kind];
		const edgeColor = edgeColorForGraphEdge(edge);
		const edgeSize =
			edge.kind === "gate"
				? style.size + (edge.state === "broken" ? 0.8 : edge.state === "open" ? 0.4 : 0)
				: style.size;
		const edgeId = graphEdgeId(edge);
		graph.addEdgeWithKey(edgeId, edge.fromTaskId, edge.toTaskId, {
			label: edgeLabelForSnapshotEdge(edge),
			color: edgeColor,
			originalColor: edgeColor,
			size: edgeSize,
			type: style.type,
			hidden: false,
			forceLabel: edge.kind !== "after",
			zIndex: edge.kind === "gate" ? 10 : 1,
		});
		if (style.type === "curvedArrow") {
			const key = `${edge.fromTaskId}->${edge.toTaskId}`;
			const group = curvedEdgeGroups.get(key) ?? [];
			group.push(edgeId);
			curvedEdgeGroups.set(key, group);
		}
	}

	for (const edgeIds of curvedEdgeGroups.values()) {
		edgeIds.forEach((edgeId, index) => {
			graph.setEdgeAttribute(edgeId, "curvature", parallelCurvature(index, edgeIds.length));
		});
	}

	for (const nodeId of graph.nodes()) {
		const baseSize = graph.getNodeAttribute(nodeId, "size");
		graph.setNodeAttribute(nodeId, "size", nodeSizeWithDegree(baseSize, graph.degree(nodeId)));
	}

	return graph;
};

export class GraphCanvasController {
	private readonly onSelectTask: (taskId: string) => void;
	private renderer: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes> | null = null;
	private worker: Worker | null = null;
	private host: HTMLElement | null = null;
	private cameraState = { x: 0.5, y: 0.5, ratio: 1, angle: 0 };
	private layoutRequestId = 0;
	private renderGeneration = 0;
	private nodePositions = new Map<string, { readonly x: number; readonly y: number }>();

	constructor(input: { readonly onSelectTask: (taskId: string) => void }) {
		this.onSelectTask = input.onSelectTask;
	}

	sync = async (model: GraphCanvasModel): Promise<void> => {
		this.host = model.host;
		const generation = ++this.renderGeneration;
		if (model.snapshot === null) {
			this.teardownRenderer();
			this.nodePositions.clear();
			this.host.innerHTML = renderMessage(
				"info",
				"Waiting for the first graph snapshot. Refresh now or wait for the websocket push.",
			);
			return;
		}

		if (shouldRelayoutGraph(model.snapshot, model.graphDiff, this.nodePositions)) {
			this.host.innerHTML = renderMessage("info", "Computing dagre layout in the module worker…");
			try {
				const requestId = ++this.layoutRequestId;
				const layoutResult = await this.requestLayout(
					buildLayoutRequest(model.snapshot, requestId),
				);
				if (generation !== this.renderGeneration) {
					return;
				}
				this.nodePositions = new Map(nodePositionsFromLayoutResult(layoutResult));
			} catch (error) {
				if (generation !== this.renderGeneration) {
					return;
				}
				this.teardownRenderer();
				this.host.innerHTML = renderMessage(
					"error",
					`Layout worker failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				return;
			}
		}

		if (generation !== this.renderGeneration) {
			return;
		}

		try {
			this.renderGraph(model.snapshot, model.selectedTaskId);
		} catch (error) {
			this.teardownRenderer();
			this.host.innerHTML = renderMessage(
				"error",
				`Graph renderer failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

	private renderGraph = (snapshot: FrontendGraphSnapshot, selectedTaskId: string | null): void => {
		if (this.host === null) {
			return;
		}

		this.host.innerHTML =
			'<div class="graph-canvas__viewport" data-role="graph-canvas-viewport"></div>';
		const viewport = this.host.querySelector<HTMLElement>('[data-role="graph-canvas-viewport"]');
		if (viewport === null) {
			throw new Error("Graph viewport container is missing.");
		}

		const graph = buildSigmaGraph(snapshot, selectedTaskId, this.nodePositions);
		const focus = buildGraphFocus(snapshot, selectedTaskId);
		const previousCameraState = this.renderer?.getCamera().getState() ?? this.cameraState;
		this.teardownRenderer();

		const edgePrograms: Record<
			string,
			EdgeProgramType<SigmaNodeAttributes, SigmaEdgeAttributes>
		> = {
			arrow: EdgeArrowProgram as unknown as EdgeProgramType<
				SigmaNodeAttributes,
				SigmaEdgeAttributes
			>,
			curved: EdgeCurveProgram as unknown as EdgeProgramType<
				SigmaNodeAttributes,
				SigmaEdgeAttributes
			>,
			curvedArrow: EdgeCurvedArrowProgram as unknown as EdgeProgramType<
				SigmaNodeAttributes,
				SigmaEdgeAttributes
			>,
		};
		const renderer = new Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>(graph, viewport, {
			renderLabels: true,
			renderEdgeLabels: true,
			// Show labels at most zoom levels (small discs) and let the grid/density
			// cull only where labels would genuinely overprint, so they fade in on
			// zoom the way the reference graph does instead of vanishing entirely.
			// The grid cell tracks the layout's node spacing so adjacent nodes each
			// keep their label until a zoom-out actually packs them together.
			labelRenderedSizeThreshold: 2,
			labelDensity: 2,
			labelGridCellSize: 64,
			labelFont: "Inter, ui-sans-serif, system-ui, sans-serif",
			labelSize: 13,
			labelWeight: "600",
			defaultDrawNodeLabel: drawNodeLabelBelow,
			defaultDrawNodeHover: drawNodeHoverBelow,
			edgeLabelFont: "Inter, ui-sans-serif, system-ui, sans-serif",
			edgeLabelSize: 12,
			edgeLabelWeight: "600",
			defaultEdgeColor: "#64748b",
			zIndex: true,
			enableEdgeEvents: false,
			defaultEdgeType: "arrow",
			edgeProgramClasses: edgePrograms,
			minCameraRatio: graphVisualStyle.minCameraRatio,
			maxCameraRatio: graphVisualStyle.maxCameraRatio,
			nodeReducer: (nodeId, data) => {
				if (selectedTaskId === null) {
					return data;
				}
				if (!focus.highlightedNodeIds.has(nodeId)) {
					return {
						...data,
						color: graphVisualStyle.dimmedNodeColor,
						label: null,
					};
				}
				let size = data.size;
				let zIndex = 20;
				let color: string | undefined;
				let highlighted = false;
				if (nodeId === selectedTaskId) {
					highlighted = true;
					size += graphVisualStyle.focusedNodeSizeBoost;
					zIndex = 80;
				} else if (focus.branchNodeIds.has(nodeId)) {
					size += graphVisualStyle.branchNodeSizeBoost;
					zIndex = 40;
				} else {
					size += graphVisualStyle.relatedNodeSizeBoost;
				}
				const gateState = focus.gateNodeStates.get(nodeId);
				if (gateState !== undefined) {
					color = gateNodeColor(gateState);
					zIndex = Math.max(zIndex, gateState === "broken" ? 70 : 50);
				}
				if (focus.brokenNodeIds.has(nodeId)) {
					size += 1;
					zIndex = Math.max(zIndex, 75);
				}
				return {
					...data,
					forceLabel: true,
					highlighted,
					size,
					zIndex,
					...(color === undefined ? {} : { color }),
				};
			},
			edgeReducer: (edgeId, data) => {
				if (selectedTaskId === null) {
					return data;
				}
				if (!focus.highlightedEdgeIds.has(edgeId)) {
					return {
						...data,
						color: graphVisualStyle.dimmedEdgeColor,
						label: null,
					};
				}
				return {
					...data,
					forceLabel: true,
					size: data.size + 0.8,
				};
			},
		});

		renderer.getCamera().setState(previousCameraState);
		renderer.on("clickNode", ({ node }) => {
			this.onSelectTask(node);
		});
		this.renderer = renderer;
		this.cameraState = previousCameraState;
	};

	private requestLayout = async (request: LayoutRequest): Promise<LayoutResult> => {
		const worker = this.getWorker();
		return new Promise<LayoutResult>((resolve, reject) => {
			const onMessage = (event: MessageEvent<LayoutWorkerMessage>): void => {
				const message = event.data;
				if (message.kind === "layout_result" && message.result.requestId === request.requestId) {
					worker.removeEventListener("message", onMessage);
					worker.removeEventListener("error", onError);
					resolve(message.result);
					return;
				}
				if (message.kind === "layout_error" && message.requestId === request.requestId) {
					worker.removeEventListener("message", onMessage);
					worker.removeEventListener("error", onError);
					reject(new Error(message.message));
				}
			};
			const onError = (event: ErrorEvent): void => {
				worker.removeEventListener("message", onMessage);
				worker.removeEventListener("error", onError);
				reject(new Error(event.message || "Unknown layout worker error."));
			};
			worker.addEventListener("message", onMessage);
			worker.addEventListener("error", onError, { once: true });
			worker.postMessage(request);
		});
	};

	private getWorker = (): Worker => {
		if (this.worker !== null) {
			return this.worker;
		}
		try {
			this.worker = new Worker(new URL("/layout-worker.js", window.location.origin), {
				type: "module",
			});
			return this.worker;
		} catch (error) {
			throw new Error(
				`Unable to start layout worker: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

	private teardownRenderer = (): void => {
		if (this.renderer === null) {
			return;
		}
		this.cameraState = this.renderer.getCamera().getState();
		this.renderer.kill();
		this.renderer = null;
	};
}
