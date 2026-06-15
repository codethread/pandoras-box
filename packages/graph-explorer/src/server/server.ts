import { createServer } from "node:http";
import type { ServerResponse } from "node:http";

import { isGraphExplorerError } from "../errors.js";
import type { GraphExplorerHandle, GraphExplorerOptions } from "../types.js";
import { handleApiRequest } from "./api.js";
import { makePithosReader } from "./pithos-reader.js";
import { parseGraphExplorerOptions } from "./schemas.js";
import { liveServerServices } from "./services.js";
import { serveStaticRequest } from "./static.js";
import { baseUrlForHost, formatHostForUrl } from "./url.js";
import { attachGraphWebsocketSupport } from "./websocket.js";

const closeServer = async (server: ReturnType<typeof createServer>): Promise<void> =>
	new Promise((resolve, reject) => {
		server.close((error) => {
			if (error !== undefined) {
				reject(error);
				return;
			}

			resolve();
		});
	});

const writeUnexpectedError = (response: ServerResponse, error: unknown): void => {
	response.statusCode = isGraphExplorerError(error) ? 400 : 500;
	response.setHeader("content-type", "application/json; charset=utf-8");
	response.end(
		JSON.stringify({
			code: isGraphExplorerError(error) ? error.code : "INTERNAL_ERROR",
			message: error instanceof Error ? error.message : "Unexpected explorer server error",
		}),
	);
};

export const startGraphExplorer = async (
	input: GraphExplorerOptions,
): Promise<GraphExplorerHandle> => {
	let runtimeOptions = parseGraphExplorerOptions(input);
	const reader = makePithosReader({
		pithosDbPath: runtimeOptions.pithosDbPath,
		services: liveServerServices,
	});

	const server = createServer((request, response) => {
		void (async () => {
			const handledApi = await handleApiRequest(request, response, {
				options: runtimeOptions,
				reader,
				services: liveServerServices,
			});
			if (handledApi) {
				return;
			}

			const requestUrl = new URL(request.url ?? "/", baseUrlForHost(runtimeOptions.host));
			const handledStatic = await serveStaticRequest(
				requestUrl.pathname,
				response,
				liveServerServices,
			);
			if (handledStatic) {
				return;
			}

			response.statusCode = 404;
			response.setHeader("content-type", "application/json; charset=utf-8");
			response.end(
				JSON.stringify({
					code: "INVALID_REQUEST",
					message: `No explorer route for '${requestUrl.pathname}'`,
				}),
			);
		})().catch((error) => {
			writeUnexpectedError(response, error);
		});
	});

	const websocket = attachGraphWebsocketSupport(server, {
		getOptions: () => runtimeOptions,
		reader,
		services: liveServerServices,
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(runtimeOptions.port, runtimeOptions.host, () => {
			server.off("error", reject);
			resolve();
		});
	});

	const address = server.address();
	if (address === null || typeof address === "string") {
		await websocket.close();
		await closeServer(server);
		throw new Error("Graph explorer server did not expose a numeric address");
	}

	const boundPort = address.port;
	runtimeOptions = { ...runtimeOptions, port: boundPort };
	const url = `http://${formatHostForUrl(runtimeOptions.host)}:${String(boundPort)}`;
	let stopPromise: Promise<void> | undefined;

	return {
		host: runtimeOptions.host,
		port: boundPort,
		url,
		stop: async () => {
			stopPromise ??= (async () => {
				await websocket.close();
				await closeServer(server);
			})();
			await stopPromise;
		},
	};
};
