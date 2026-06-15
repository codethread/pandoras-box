import type { IncomingMessage, ServerResponse } from "node:http";

import { GraphExplorerError, isGraphExplorerError } from "../errors.js";
import type { ResolvedGraphExplorerOptions } from "../types.js";
import { readDaemonStatus } from "./daemon-status.js";
import type { PithosReader } from "./pithos-reader.js";
import { formatSelector, parseGraphReadRequestQuery, parseTaskIdPath } from "./schemas.js";
import type { ServerServices } from "./services.js";
import { baseUrlForHost } from "./url.js";

export interface ApiContext {
	readonly options: ResolvedGraphExplorerOptions;
	readonly reader: PithosReader;
	readonly services: ServerServices;
}

const writeJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
	response.statusCode = statusCode;
	response.setHeader("content-type", "application/json; charset=utf-8");
	response.end(JSON.stringify(body));
};

const writeError = (response: ServerResponse, error: unknown): void => {
	if (isGraphExplorerError(error)) {
		const statusCode =
			error.code === "INVALID_OPTION" || error.code === "INVALID_REQUEST"
				? 400
				: error.code === "NOT_FOUND"
					? 404
					: 500;
		writeJson(response, statusCode, { code: error.code, message: error.message });
		return;
	}

	writeJson(response, 500, {
		code: "INTERNAL_ERROR",
		message: error instanceof Error ? error.message : "Unexpected explorer server error",
	});
};

const assertReadOnlyMethod = (request: IncomingMessage): void => {
	if (request.method !== undefined && request.method !== "GET") {
		throw new GraphExplorerError({
			code: "INVALID_REQUEST",
			message: `Unsupported method '${request.method ?? "unknown"}'`,
		});
	}
};

export const handleApiRequest = async (
	request: IncomingMessage,
	response: ServerResponse,
	context: ApiContext,
): Promise<boolean> => {
	const url = new URL(request.url ?? "/", baseUrlForHost(context.options.host));
	if (!url.pathname.startsWith("/api/")) {
		return false;
	}

	try {
		assertReadOnlyMethod(request);

		switch (url.pathname) {
			case "/api/health": {
				writeJson(response, 200, { ok: true });
				return true;
			}
			case "/api/config": {
				writeJson(response, 200, {
					host: context.options.host,
					port: context.options.port,
					initialSelector: context.options.initialSelector,
					selectorLabel: formatSelector(context.options.initialSelector),
					websocketPath: "/ws/graph",
				});
				return true;
			}
			case "/api/graph": {
				const graphRequest = parseGraphReadRequestQuery(
					url,
					context.options.initialSelector,
					context.services.clock.nowIso(),
				);
				const snapshot = await context.reader.readGraphSnapshot(graphRequest);
				writeJson(response, 200, snapshot);
				return true;
			}
			case "/api/daemon/status": {
				const daemonStatus = await readDaemonStatus(context.options.pdxDataDir, context.services);
				writeJson(response, 200, daemonStatus);
				return true;
			}
			default: {
				if (url.pathname.startsWith("/api/task/")) {
					const taskId = parseTaskIdPath(url.pathname);
					const snapshot = await context.reader.readTaskSnapshot(taskId);
					writeJson(response, 200, snapshot);
					return true;
				}

				writeJson(response, 404, {
					code: "INVALID_REQUEST",
					message: `No explorer API route for '${url.pathname}'`,
				});
				return true;
			}
		}
	} catch (error) {
		writeError(response, error);
		return true;
	}
};
