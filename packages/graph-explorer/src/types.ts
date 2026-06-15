export interface ExplorerSelectorGlobal {
	readonly kind: "global";
}

export interface ExplorerSelectorAll {
	readonly kind: "all";
}

export interface ExplorerSelectorScope {
	readonly kind: "scope";
	readonly scopeId: string;
}

export interface ExplorerSelectorTask {
	readonly kind: "task";
	readonly taskId: string;
}

export type ExplorerSelector =
	| ExplorerSelectorGlobal
	| ExplorerSelectorAll
	| ExplorerSelectorScope
	| ExplorerSelectorTask;

export interface GraphExplorerOptions {
	readonly pithosDbPath: string;
	readonly pdxDataDir: string;
	readonly host?: string;
	readonly port?: number;
	readonly initialSelector?: ExplorerSelector;
}

export interface ResolvedGraphExplorerOptions {
	readonly pithosDbPath: string;
	readonly pdxDataDir: string;
	readonly host: string;
	readonly port: number;
	readonly initialSelector: ExplorerSelector;
}

export interface GraphExplorerHandle {
	readonly url: string;
	readonly host: string;
	readonly port: number;
	readonly stop: () => Promise<void>;
}
