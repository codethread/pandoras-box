export interface LayoutNodeInput {
	readonly id: string;
	readonly width: number;
	readonly height: number;
}

export interface LayoutEdgeInput {
	readonly id: string;
	readonly fromTaskId: string;
	readonly toTaskId: string;
	readonly kind: string;
}

export interface LayoutRequest {
	readonly requestId: number;
	readonly nodes: readonly LayoutNodeInput[];
	readonly edges: readonly LayoutEdgeInput[];
	readonly rankDirection: "TB" | "LR";
}

export interface LayoutPosition {
	readonly id: string;
	readonly x: number;
	readonly y: number;
}

export interface LayoutResult {
	readonly requestId: number;
	readonly positions: readonly LayoutPosition[];
	readonly width: number;
	readonly height: number;
}

export type LayoutWorkerMessage =
	| {
			readonly kind: "layout_result";
			readonly result: LayoutResult;
	  }
	| {
			readonly kind: "layout_error";
			readonly requestId: number;
			readonly message: string;
	  };
