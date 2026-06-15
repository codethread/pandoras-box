import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { GraphExplorerError } from "../errors.js";
import type { ResolvedGraphExplorerOptions } from "../types.js";
import { readDaemonStatus } from "./daemon-status.js";
import type { PithosReader } from "./pithos-reader.js";
import { parseGraphWebsocketClientMessage, type GraphReadRequest } from "./schemas.js";
import type { ServerServices } from "./services.js";
import { baseUrlForHost } from "./url.js";

const GRAPH_WEBSOCKET_PATH = "/ws/graph";
const POLL_INTERVAL_MS = 30_000;

interface GraphWebsocketContext {
	readonly getOptions: () => ResolvedGraphExplorerOptions;
	readonly reader: PithosReader;
	readonly services: ServerServices;
}

interface WebsocketClientState {
	readonly socket: WebSocket;
	query: GraphReadRequest;
	lastSuccessAt: string | null;
	queryRevision: number;
}

export interface GraphWebsocketController {
	readonly close: () => Promise<void>;
}

const writeUpgradeFailure = (socket: Socket, statusLine: string, body: unknown): void => {
	const payload = Buffer.from(JSON.stringify(body));
	socket.write(
		[
			statusLine,
			"Connection: close",
			"Content-Type: application/json; charset=utf-8",
			`Content-Length: ${String(payload.byteLength)}`,
			"",
			"",
		].join("\r\n"),
	);
	socket.write(payload);
	socket.destroy();
};

const rawDataToText = (data: RawData): string => {
	if (typeof data === "string") {
		return data;
	}
	if (data instanceof ArrayBuffer) {
		return Buffer.from(data).toString("utf8");
	}
	if (Array.isArray(data)) {
		return Buffer.concat(
			data.map((entry) => (Buffer.isBuffer(entry) ? entry : Buffer.from(entry))),
		).toString("utf8");
	}
	return data.toString("utf8");
};

const sendMessage = (socket: WebSocket, body: unknown): void => {
	if (socket.readyState !== WebSocket.OPEN) {
		return;
	}
	socket.send(JSON.stringify(body));
};

const sendError = (socket: WebSocket, error: unknown): void => {
	const graphError =
		error instanceof GraphExplorerError
			? error
			: new GraphExplorerError({
					code: "INTERNAL_ERROR",
					message: error instanceof Error ? error.message : "Unexpected websocket error",
				});
	sendMessage(socket, {
		kind: "error",
		code: graphError.code,
		message: graphError.message,
	});
};

const sendStale = (socket: WebSocket, message: string, lastSuccessAt: string | null): void => {
	sendMessage(socket, {
		kind: "stale",
		message,
		lastSuccessAt,
	});
};

export const attachGraphWebsocketSupport = (
	server: Server,
	context: GraphWebsocketContext,
): GraphWebsocketController => {
	const websocketServer = new WebSocketServer({ noServer: true });
	const clients = new Set<WebsocketClientState>();
	let revision = 0;

	const sendSnapshot = async (
		client: WebsocketClientState,
		request: GraphReadRequest,
		queryRevision: number,
	): Promise<boolean> => {
		const snapshot = await context.reader.readGraphSnapshot(request);
		if (queryRevision !== client.queryRevision) {
			return false;
		}
		client.lastSuccessAt = snapshot.generatedAt;
		sendMessage(client.socket, {
			kind: "snapshot",
			revision: ++revision,
			snapshot,
		});
		return true;
	};

	const sendDaemonStatus = async (
		client: WebsocketClientState,
		queryRevision: number,
	): Promise<void> => {
		const daemonStatus = await readDaemonStatus(context.getOptions().pdxDataDir, context.services);
		if (queryRevision !== client.queryRevision) {
			return;
		}
		sendMessage(client.socket, {
			kind: "daemon_status",
			daemonStatus,
		});
	};

	const refreshClient = async (client: WebsocketClientState): Promise<void> => {
		const request = client.query;
		const queryRevision = client.queryRevision;
		try {
			const sent = await sendSnapshot(client, request, queryRevision);
			if (!sent) {
				return;
			}
		} catch (error) {
			if (queryRevision !== client.queryRevision) {
				return;
			}
			if (client.lastSuccessAt === null) {
				throw error;
			}
			sendStale(
				client.socket,
				error instanceof Error
					? `Graph snapshot refresh failed: ${error.message}`
					: "Graph snapshot refresh failed.",
				client.lastSuccessAt,
			);
			return;
		}
		try {
			await sendDaemonStatus(client, queryRevision);
		} catch (error) {
			if (queryRevision !== client.queryRevision) {
				return;
			}
			sendError(client.socket, error);
		}
	};

	const pollClients = async (): Promise<void> => {
		for (const client of clients) {
			await refreshClient(client).catch((error) => {
				sendError(client.socket, error);
			});
		}
	};

	const pollTimer = setInterval(() => {
		void pollClients();
	}, POLL_INTERVAL_MS);
	pollTimer.unref();

	websocketServer.on("connection", (socket: WebSocket) => {
		const options = context.getOptions();
		const client: WebsocketClientState = {
			socket,
			query: {
				selector: options.initialSelector,
				status: [],
				search: [],
				since: undefined,
				until: undefined,
				sinceCutoff: undefined,
				untilCutoff: undefined,
			},
			lastSuccessAt: null,
			queryRevision: 0,
		};
		clients.add(client);

		socket.on("message", (data) => {
			void (async () => {
				const message = parseGraphWebsocketClientMessage(
					rawDataToText(data),
					client.query.selector,
					context.services.clock.nowIso(),
				);
				if (message.kind === "refresh") {
					await refreshClient(client);
					return;
				}
				client.query = message.request;
				client.queryRevision += 1;
				if (message.lastSuccessAt !== undefined) {
					client.lastSuccessAt = message.lastSuccessAt;
				}
				await refreshClient(client);
			})().catch((error) => {
				sendError(socket, error);
			});
		});

		socket.on("close", () => {
			clients.delete(client);
		});
	});

	server.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
		const url = new URL(request.url ?? "/", baseUrlForHost(context.getOptions().host));
		if (url.pathname !== GRAPH_WEBSOCKET_PATH) {
			writeUpgradeFailure(socket, "HTTP/1.1 404 Not Found", {
				code: "INVALID_REQUEST",
				message: `No explorer websocket route for '${url.pathname}'`,
			});
			return;
		}

		websocketServer.handleUpgrade(request, socket, head, (websocket) => {
			websocketServer.emit("connection", websocket, request);
		});
	});

	return {
		close: () =>
			new Promise((resolve, reject) => {
				clearInterval(pollTimer);
				for (const client of clients) {
					client.socket.close();
				}
				websocketServer.close((error) => {
					if (error !== undefined) {
						reject(error);
						return;
					}
					resolve();
				});
			}),
	};
};
