export type ErrorCode =
	| "INTERNAL_ERROR"
	| "INVALID_OPTION"
	| "INVALID_REQUEST"
	| "NOT_FOUND"
	| "NOT_IMPLEMENTED"
	| "STATIC_ASSET_NOT_FOUND";

export class GraphExplorerError extends Error {
	readonly code: ErrorCode;

	constructor(input: { readonly code: ErrorCode; readonly message: string }) {
		super(input.message);
		this.name = "GraphExplorerError";
		this.code = input.code;
	}
}

export const isGraphExplorerError = (error: unknown): error is GraphExplorerError =>
	error instanceof GraphExplorerError;
