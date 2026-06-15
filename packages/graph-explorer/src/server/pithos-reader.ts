import {
	PithosError,
	liveServices,
	makeEngine,
	type Engine,
	type GraphInspectOutput,
	type TaskInspectOutput,
	type TaskStatus,
} from "@pdx/pithos";

import { GraphExplorerError } from "../errors.js";
import type { ExplorerSelector } from "../types.js";
import type { GraphReadRequest } from "./schemas.js";
import type { ServerServices } from "./services.js";

export interface GraphSnapshot {
	readonly kind: "graph_snapshot";
	readonly selector: ExplorerSelector;
	readonly generatedAt: string;
	readonly graph: GraphInspectOutput;
	readonly filters: {
		readonly status: readonly TaskStatus[];
		readonly search: readonly string[];
		readonly since: string | undefined;
		readonly until: string | undefined;
	};
	readonly pithosDbPath: string;
}

export interface TaskSnapshot {
	readonly kind: "task_snapshot";
	readonly taskId: string;
	readonly generatedAt: string;
	readonly task: TaskInspectOutput;
	readonly pithosDbPath: string;
}

export interface PithosReader {
	readonly readGraphSnapshot: (request: GraphReadRequest) => Promise<GraphSnapshot>;
	readonly readTaskSnapshot: (taskId: string) => Promise<TaskSnapshot>;
}

const graphInspectInputForSelector = (
	selector: ExplorerSelector,
): {
	readonly taskId: string | undefined;
	readonly scope: string | undefined;
	readonly all: boolean;
} => {
	switch (selector.kind) {
		case "global":
			return { taskId: undefined, scope: "global", all: false };
		case "all":
			return { taskId: undefined, scope: undefined, all: true };
		case "scope":
			return { taskId: undefined, scope: selector.scopeId, all: false };
		case "task":
			return { taskId: selector.taskId, scope: undefined, all: false };
	}
};

const mapPithosError = (error: unknown): never => {
	if (error instanceof PithosError) {
		if (error.code === "NOT_FOUND") {
			throw new GraphExplorerError({ code: "NOT_FOUND", message: error.message });
		}
		if (error.code === "VALIDATION_ERROR" || error.code === "USER_ERROR") {
			throw new GraphExplorerError({ code: "INVALID_REQUEST", message: error.message });
		}
		throw new GraphExplorerError({ code: "INTERNAL_ERROR", message: error.message });
	}

	throw error;
};

const assertPithosDbExists = async (
	pithosDbPath: string,
	services: ServerServices,
): Promise<void> => {
	if (await services.fileSystem.fileExists(pithosDbPath)) {
		return;
	}

	throw new GraphExplorerError({
		code: "NOT_FOUND",
		message: `Pithos DB not found at '${pithosDbPath}'`,
	});
};

const graphInspectInputForRequest = (
	request: GraphReadRequest,
): Parameters<Engine["graphInspect"]>[0] => {
	const base = graphInspectInputForSelector(request.selector);
	const filters = {
		...(request.status.length > 0 ? { status: request.status } : {}),
		...(request.search.length > 0 ? { search: request.search } : {}),
		...(request.sinceCutoff === undefined ? {} : { sinceCutoff: request.sinceCutoff }),
		...(request.untilCutoff === undefined ? {} : { untilCutoff: request.untilCutoff }),
	};
	return { ...base, ...filters };
};

export const makePithosReader = (input: {
	readonly pithosDbPath: string;
	readonly services: ServerServices;
}): PithosReader => {
	const engine: Engine = makeEngine({
		config: { dbPath: input.pithosDbPath },
		services: liveServices,
	});

	return {
		readGraphSnapshot: async (request) => {
			await assertPithosDbExists(input.pithosDbPath, input.services);
			try {
				const graph = engine.graphInspect(graphInspectInputForRequest(request));
				return {
					kind: "graph_snapshot",
					selector: request.selector,
					generatedAt: input.services.clock.nowIso(),
					graph,
					filters: {
						status: request.status,
						search: request.search,
						since: request.since,
						until: request.until,
					},
					pithosDbPath: input.pithosDbPath,
				};
			} catch (error) {
				return mapPithosError(error);
			}
		},
		readTaskSnapshot: async (taskId) => {
			if (taskId.trim().length === 0) {
				throw new GraphExplorerError({
					code: "INVALID_REQUEST",
					message: "taskId must be a non-empty string",
				});
			}

			await assertPithosDbExists(input.pithosDbPath, input.services);
			try {
				return {
					kind: "task_snapshot",
					taskId,
					generatedAt: input.services.clock.nowIso(),
					task: engine.taskInspect({ taskId }),
					pithosDbPath: input.pithosDbPath,
				};
			} catch (error) {
				return mapPithosError(error);
			}
		},
	};
};
