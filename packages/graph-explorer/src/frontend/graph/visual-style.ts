export type GraphNodeVisualState = "claimable" | "running" | "done" | "broken" | "queued";

export interface CapabilityBadgeStyle {
	readonly evil: string;
	readonly capability: string;
	readonly glyph: string;
	readonly color: string;
}

export interface NodeStatusStyle {
	readonly fill: string;
	readonly ring: string;
}

export interface EdgeKindStyle {
	readonly color: string;
	readonly label: string;
	readonly size: number;
	readonly type: "arrow" | "curvedArrow";
}

export interface GateStateStyle {
	readonly color: string;
	readonly label: string;
	readonly nodeColor: string;
}

export const capabilityBadgeStyles = {
	escalate: {
		evil: "Pandora",
		capability: "escalate",
		glyph: "👑",
		color: "#c084fc",
	},
	intake: {
		evil: "Envy",
		capability: "intake",
		glyph: "👁",
		color: "#2dd4bf",
	},
	clarify: {
		evil: "Envy",
		capability: "clarify",
		glyph: "👁",
		color: "#2dd4bf",
	},
	triage: {
		evil: "Toil",
		capability: "triage",
		glyph: "🔨",
		color: "#60a5fa",
	},
	design: {
		evil: "Greed",
		capability: "design",
		glyph: "💎",
		color: "#fbbf24",
	},
	review: {
		evil: "Greed",
		capability: "review",
		glyph: "💎",
		color: "#fbbf24",
	},
	execute: {
		evil: "War",
		capability: "execute",
		glyph: "⚔",
		color: "#f87171",
	},
} as const satisfies Record<string, CapabilityBadgeStyle>;

export const nodeStatusStyles: Record<GraphNodeVisualState, NodeStatusStyle> = {
	claimable: {
		fill: "#2563eb",
		ring: "#93c5fd",
	},
	running: {
		fill: "#d97706",
		ring: "#fcd34d",
	},
	done: {
		fill: "#15803d",
		ring: "#86efac",
	},
	broken: {
		fill: "#b91c1c",
		ring: "#fca5a5",
	},
	queued: {
		fill: "#475569",
		ring: "#94a3b8",
	},
};

export const gateStateStyles = {
	clear: {
		color: "#22c55e",
		label: "gate clear",
		nodeColor: "#34d399",
	},
	open: {
		color: "#f59e0b",
		label: "gate open",
		nodeColor: "#fbbf24",
	},
	broken: {
		color: "#ef4444",
		label: "gate broken",
		nodeColor: "#f87171",
	},
} as const satisfies Record<string, GateStateStyle>;

export const edgeKindStyles = {
	after: {
		color: "#94a3b8",
		label: "after",
		size: 2.5,
		type: "arrow",
	},
	gate: {
		color: gateStateStyles.open.color,
		label: "gate",
		size: 4,
		type: "curvedArrow",
	},
	about: {
		color: "#a78bfa",
		label: "about",
		size: 2.5,
		type: "curvedArrow",
	},
	repair: {
		color: "#ef4444",
		label: "repair",
		size: 3,
		type: "curvedArrow",
	},
	supersedes: {
		color: "#f472b6",
		label: "supersedes",
		size: 2.5,
		type: "curvedArrow",
	},
} as const satisfies Record<string, EdgeKindStyle>;

export const graphVisualStyle = {
	capabilityBadges: capabilityBadgeStyles,
	nodeStates: nodeStatusStyles,
	gateStates: gateStateStyles,
	edges: edgeKindStyles,
	dimmedNodeColor: "rgba(71, 85, 105, 0.35)",
	dimmedEdgeColor: "rgba(71, 85, 105, 0.22)",
	focusedNodeSizeBoost: 6,
	branchNodeSizeBoost: 2,
	relatedNodeSizeBoost: 1,
	minCameraRatio: 0.08,
	maxCameraRatio: 3,
} as const;

export const isBrokenTaskStatus = (status: string): boolean =>
	status === "failed" || status === "cancelled" || status === "dead_letter";

export const visualStateForTask = (input: {
	readonly status: string;
	readonly claimable: boolean;
}): GraphNodeVisualState => {
	if (input.claimable) {
		return "claimable";
	}
	if (input.status === "running" || input.status === "claimed") {
		return "running";
	}
	if (input.status === "done") {
		return "done";
	}
	if (isBrokenTaskStatus(input.status)) {
		return "broken";
	}
	return "queued";
};

export const capabilityBadgeLabel = (capability: keyof typeof capabilityBadgeStyles): string => {
	const badge = capabilityBadgeStyles[capability];
	return `${badge.glyph} ${badge.evil}/${badge.capability}`;
};

export const edgeColorForGraphEdge = (edge: {
	readonly kind: keyof typeof edgeKindStyles;
	readonly state?: keyof typeof gateStateStyles;
}): string =>
	edge.kind === "gate"
		? gateStateStyles[edge.state ?? "open"].color
		: edgeKindStyles[edge.kind].color;

export const gateNodeColor = (state: keyof typeof gateStateStyles): string =>
	gateStateStyles[state].nodeColor;
