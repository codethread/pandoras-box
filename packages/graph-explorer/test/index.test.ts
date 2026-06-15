import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server as NetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, type RawData } from "ws";

import { liveServices, makeEngine, openDb } from "@pdx/pithos";

import { startGraphExplorer, type GraphExplorerHandle } from "../src/index.js";
import type { DaemonStatusSnapshot } from "../src/server/daemon-status.js";
import type { GraphSnapshot, TaskSnapshot } from "../src/server/pithos-reader.js";
import {
	parseGraphReadRequestInput,
	parseGraphWebsocketClientMessage,
} from "../src/server/schemas.js";

const handles: GraphExplorerHandle[] = [];
const tempDirs: string[] = [];
const daemonServers: NetServer[] = [];

interface ExplorerFixture {
	readonly dataDir: string;
	readonly dbPath: string;
	readonly scopeId: string;
	readonly rootTaskId: string;
	readonly childTaskId: string;
}

type GraphWebsocketServerMessage =
	| {
			readonly kind: "snapshot";
			readonly revision: number;
			readonly snapshot: GraphSnapshot;
	  }
	| {
			readonly kind: "daemon_status";
			readonly daemonStatus: DaemonStatusSnapshot;
	  }
	| {
			readonly kind: "stale";
			readonly message: string;
			readonly lastSuccessAt: string | null;
	  }
	| {
			readonly kind: "error";
			readonly code: string;
			readonly message: string;
	  };

interface GraphWebsocketServerMessageMap {
	snapshot: Extract<GraphWebsocketServerMessage, { kind: "snapshot" }>;
	daemon_status: Extract<GraphWebsocketServerMessage, { kind: "daemon_status" }>;
	stale: Extract<GraphWebsocketServerMessage, { kind: "stale" }>;
	error: Extract<GraphWebsocketServerMessage, { kind: "error" }>;
}

type CollectedWebsocketMessages = Partial<
	Record<GraphWebsocketServerMessage["kind"], GraphWebsocketServerMessage>
>;

const fail = (message: string): never => {
	throw new Error(message);
};

const asJsonRecord = (value: unknown): Record<string, unknown> => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return fail("Expected JSON object");
	}
	return value as Record<string, unknown>;
};

const readResponseJson = async (response: Response): Promise<unknown> =>
	JSON.parse(await response.text()) as unknown;

const parseGraphSnapshot = (value: unknown): GraphSnapshot => {
	const record = asJsonRecord(value);
	if (record.kind !== "graph_snapshot") {
		return fail("Expected graph_snapshot payload");
	}
	return value as GraphSnapshot;
};

const parseTaskSnapshot = (value: unknown): TaskSnapshot => {
	const record = asJsonRecord(value);
	if (record.kind !== "task_snapshot") {
		return fail("Expected task_snapshot payload");
	}
	return value as TaskSnapshot;
};

const parseWebsocketServerMessage = (value: unknown): GraphWebsocketServerMessage => {
	const record = asJsonRecord(value);
	switch (record.kind) {
		case "snapshot":
			if (typeof record.revision !== "number") {
				return fail("Expected snapshot revision");
			}
			return {
				kind: "snapshot",
				revision: record.revision,
				snapshot: parseGraphSnapshot(record.snapshot),
			};
		case "daemon_status":
			return {
				kind: "daemon_status",
				daemonStatus: record.daemonStatus as DaemonStatusSnapshot,
			};
		case "stale":
			if (
				typeof record.message !== "string" ||
				(record.lastSuccessAt !== null && typeof record.lastSuccessAt !== "string")
			) {
				return fail("Expected websocket stale payload");
			}
			return {
				kind: "stale",
				message: record.message,
				lastSuccessAt: record.lastSuccessAt ?? null,
			};
		case "error":
			if (typeof record.code !== "string" || typeof record.message !== "string") {
				return fail("Expected websocket error payload");
			}
			return {
				kind: "error",
				code: record.code,
				message: record.message,
			};
		default:
			return fail("Unsupported websocket message kind");
	}
};

const websocketDataToText = (data: RawData): string => {
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

const messageByKind = <K extends keyof GraphWebsocketServerMessageMap>(
	messages: CollectedWebsocketMessages,
	kind: K,
): GraphWebsocketServerMessageMap[K] => {
	const message = messages[kind];
	if (message === undefined) {
		return fail(`Missing websocket message '${kind}'`);
	}
	if (message.kind !== kind) {
		return fail(`Unexpected websocket message kind '${message.kind}'`);
	}
	return message as GraphWebsocketServerMessageMap[K];
};

const createTempDir = (prefix: string): string => {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
};

const dbTimestampToIso = (dbTimestamp: string): string => dbTimestamp.replace(" ", "T") + "Z";

const seedExplorerFixture = (): ExplorerFixture => {
	const dataDir = createTempDir("graph-explorer-");
	const dbPath = join(dataDir, "pithos.sqlite");
	const repoDir = join(dataDir, "repo");
	mkdirSync(repoDir, { recursive: true });

	const engine = makeEngine({
		config: { dbPath, runId: "run_graph_explorer_test" },
		services: liveServices,
	});
	engine.init({ fresh: true });

	const scopeId = engine.scopeUpsert({ kind: "repo", path: repoDir }).scope.id;
	engine.runUpsert({
		agent: "toil",
		mode: "afk",
		scope: scopeId,
		cwd: repoDir,
		harnessKind: "pi",
		sessionLogPath: join(dataDir, "session.jsonl"),
		sessionId: "session_graph_explorer_test",
		runId: "run_graph_explorer_test",
	});
	const rootTaskId = engine.enqueue({
		scope: scopeId,
		capability: "triage",
		title: "Route graph explorer work",
		body: "Plan the next execute slice.",
		bodyFile: undefined,
		runId: undefined,
		after: [],
		gate: undefined,
		about: undefined,
		repair: undefined,
		chain: "none",
	}).task.id;
	const childTaskId = engine.enqueue({
		scope: scopeId,
		capability: "execute",
		title: "Implement explorer server read APIs",
		body: "Serve graph and task data.",
		bodyFile: undefined,
		runId: undefined,
		after: [rootTaskId],
		gate: undefined,
		about: undefined,
		repair: undefined,
		chain: "none",
	}).task.id;

	return { dataDir, dbPath, scopeId, rootTaskId, childTaskId };
};

const waitForOpen = async (socket: WebSocket): Promise<void> =>
	new Promise((resolve, reject) => {
		socket.once("open", () => resolve());
		socket.once("error", (error) => reject(error));
	});

const readNextWebsocketMessage = async (socket: WebSocket): Promise<GraphWebsocketServerMessage> =>
	new Promise((resolve, reject) => {
		socket.once("message", (data) => {
			try {
				resolve(parseWebsocketServerMessage(JSON.parse(websocketDataToText(data)) as unknown));
			} catch (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
		socket.once("error", (error) => reject(error));
	});

const collectWebsocketMessages = async <K extends keyof GraphWebsocketServerMessageMap>(
	socket: WebSocket,
	expectedKinds: readonly K[],
): Promise<CollectedWebsocketMessages> => {
	const remaining = new Set<string>(expectedKinds);
	const messages: CollectedWebsocketMessages = {};
	while (remaining.size > 0) {
		const message = await readNextWebsocketMessage(socket);
		if (remaining.has(message.kind)) {
			remaining.delete(message.kind);
			messages[message.kind] = message;
		}
	}
	return messages;
};

const startDaemonStatusServer = async (dataDir: string): Promise<void> => {
	const socketPath = join(dataDir, "pdx.sock");
	const server = createServer((socket) => {
		let input = "";
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			input += chunk;
		});
		socket.on("end", () => {
			expect(JSON.parse(input) as unknown).toEqual({ kind: "status" });
			socket.end(
				`${JSON.stringify({
					ok: true,
					data: {
						daemon: "running",
						max_afk: 4,
						registry_entries: [{ mode: "afk" }, { mode: "hitl" }, { mode: "afk" }],
						intake_socket: join(dataDir, "intake.sock"),
					},
				})}\n`,
			);
		});
	});
	daemonServers.push(server);
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => resolve());
	});
};

afterEach(async () => {
	while (handles.length > 0) {
		const handle = handles.pop();
		if (handle !== undefined) {
			await handle.stop();
		}
	}
	while (daemonServers.length > 0) {
		const server = daemonServers.pop();
		if (server !== undefined) {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error !== undefined) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		}
	}
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir !== undefined) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe("graph explorer request parsing", () => {
	it("parses selector, status, search, and relative since filters at the boundary", () => {
		const request = parseGraphReadRequestInput(
			{
				selector: "task:task_thumb-darn-kite",
				status: ["queued", "failed"],
				search: ["graph", "daemon"],
				since: "30m",
			},
			{ kind: "global" },
			"2026-06-14T12:00:00.000Z",
		);

		expect(request.selector).toEqual({ kind: "task", taskId: "task_thumb-darn-kite" });
		expect(request.status).toEqual(["queued", "failed"]);
		expect(request.search).toEqual(["graph", "daemon"]);
		expect(request.since).toBe("30m");
		expect(request.until).toBeUndefined();
		expect(request.sinceCutoff).toBeDefined();
		expect(request.untilCutoff).toBeUndefined();
	});

	it("parses bounded absolute since and until filters at the boundary", () => {
		const request = parseGraphReadRequestInput(
			{
				since: "2026-06-14T08:30:00Z",
				until: "2026-06-14T09:45:00Z",
			},
			{ kind: "global" },
			"2026-06-14T12:00:00.000Z",
		);

		expect(request.sinceCutoff).toEqual({ dbTimestamp: "2026-06-14 08:30:00" });
		expect(request.untilCutoff).toEqual({ dbTimestamp: "2026-06-14 09:45:00" });
	});

	it("fails loudly on unsupported status filters", () => {
		expect(() =>
			parseGraphReadRequestInput(
				{ status: ["bogus"] },
				{ kind: "global" },
				"2026-06-14T12:00:00.000Z",
			),
		).toThrow("Unsupported status 'bogus'");
	});

	it("rejects incomplete or malformed absolute time ranges at the boundary", () => {
		expect(() =>
			parseGraphReadRequestInput(
				{ since: "2026-06-14T08:30:00Z" },
				{ kind: "global" },
				"2026-06-14T12:00:00.000Z",
			),
		).toThrow("absolute time filtering requires both since and until timestamps");
		expect(() =>
			parseGraphReadRequestInput(
				{ until: "2026-06-14T09:45:00Z" },
				{ kind: "global" },
				"2026-06-14T12:00:00.000Z",
			),
		).toThrow("until requires since");
		expect(() =>
			parseGraphReadRequestInput(
				{ since: "2026-06-14T09:45:00Z", until: "2026-06-14T08:30:00Z" },
				{ kind: "global" },
				"2026-06-14T12:00:00.000Z",
			),
		).toThrow("until must be greater than or equal to since");
	});

	it("parses websocket selector updates and rejects invalid JSON", () => {
		expect(
			parseGraphWebsocketClientMessage(
				JSON.stringify({ kind: "set_selector", selector: "scope:repo_scope", status: ["queued"] }),
				{ kind: "global" },
				"2026-06-14T12:00:00.000Z",
			),
		).toEqual({
			kind: "set_selector",
			request: {
				selector: { kind: "scope", scopeId: "repo_scope" },
				status: ["queued"],
				search: [],
				since: undefined,
				until: undefined,
				sinceCutoff: undefined,
				untilCutoff: undefined,
			},
		});

		expect(() =>
			parseGraphWebsocketClientMessage("not-json", { kind: "global" }, "2026-06-14T12:00:00.000Z"),
		).toThrow("Invalid websocket JSON");
	});
});

describe("startGraphExplorer", () => {
	it("serves real graph/task reads, SPA fallback routes, and boundary validation", async () => {
		const fixture = seedExplorerFixture();
		const engine = makeEngine({
			config: { dbPath: fixture.dbPath, runId: "run_graph_explorer_test" },
			services: liveServices,
		});
		const unrelatedTaskId = engine.enqueue({
			scope: fixture.scopeId,
			capability: "execute",
			title: "Out-of-range unrelated task",
			body: "Should not appear in bounded range results.",
			bodyFile: undefined,
			runId: undefined,
			after: [],
			gate: undefined,
			about: undefined,
			repair: undefined,
			chain: "none",
		}).task.id;
		const db = openDb(fixture.dbPath);
		db.prepare("UPDATE tasks SET created_at=?, updated_at=? WHERE id=?").run(
			"2026-06-14 08:00:00",
			"2026-06-14 08:00:00",
			fixture.rootTaskId,
		);
		db.prepare("UPDATE tasks SET created_at=?, updated_at=? WHERE id=?").run(
			"2026-06-14 09:00:00",
			"2026-06-14 09:00:00",
			fixture.childTaskId,
		);
		db.prepare("UPDATE tasks SET created_at=?, updated_at=? WHERE id=?").run(
			"2026-06-14 07:00:00",
			"2026-06-14 07:00:00",
			unrelatedTaskId,
		);
		db.close();
		const handle = await startGraphExplorer({
			pithosDbPath: fixture.dbPath,
			pdxDataDir: fixture.dataDir,
			host: "127.0.0.1",
			port: 0,
			initialSelector: { kind: "scope", scopeId: fixture.scopeId },
		});
		handles.push(handle);

		const configResponse = await fetch(`${handle.url}/api/config`);
		expect(configResponse.status).toBe(200);
		const config = asJsonRecord(await readResponseJson(configResponse));
		expect(config.websocketPath).toBe("/ws/graph");
		expect(config.port).toBe(handle.port);

		const graphResponse = await fetch(
			`${handle.url}/api/graph?selector=${encodeURIComponent(`scope:${fixture.scopeId}`)}`,
		);
		expect(graphResponse.status).toBe(200);
		const graphSnapshot = parseGraphSnapshot(await readResponseJson(graphResponse));
		expect(graphSnapshot.graph.graph.nodes.map((node) => node.id)).toEqual(
			expect.arrayContaining([fixture.rootTaskId, fixture.childTaskId]),
		);
		expect(graphSnapshot.graph.graph.edges).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "after",
					from_task_id: fixture.childTaskId,
					to_task_id: fixture.rootTaskId,
				}),
			]),
		);

		const boundedGraphResponse = await fetch(
			`${handle.url}/api/graph?selector=${encodeURIComponent(`scope:${fixture.scopeId}`)}&since=${encodeURIComponent(dbTimestampToIso("2026-06-14 08:30:00"))}&until=${encodeURIComponent(dbTimestampToIso("2026-06-14 09:30:00"))}`,
		);
		expect(boundedGraphResponse.status).toBe(200);
		const boundedGraphSnapshot = parseGraphSnapshot(await readResponseJson(boundedGraphResponse));
		expect(boundedGraphSnapshot.graph.graph.nodes.map((node) => node.id)).toEqual(
			expect.arrayContaining([fixture.rootTaskId, fixture.childTaskId]),
		);
		expect(boundedGraphSnapshot.graph.graph.nodes.map((node) => node.id)).not.toContain(
			unrelatedTaskId,
		);
		expect(boundedGraphSnapshot.filters.until).toBe(dbTimestampToIso("2026-06-14 09:30:00"));

		const taskResponse = await fetch(`${handle.url}/api/task/${fixture.childTaskId}`);
		expect(taskResponse.status).toBe(200);
		const taskSnapshot = parseTaskSnapshot(await readResponseJson(taskResponse));
		expect(taskSnapshot.task.task.title).toBe("Implement explorer server read APIs");

		const daemonStatusResponse = await fetch(`${handle.url}/api/daemon/status`);
		expect(daemonStatusResponse.status).toBe(200);
		expect(await readResponseJson(daemonStatusResponse)).toEqual(
			expect.objectContaining({ status: "not_running" }),
		);

		const htmlResponse = await fetch(`${handle.url}/task/${fixture.childTaskId}`);
		expect(htmlResponse.status).toBe(200);
		expect(htmlResponse.headers.get("cache-control")).toBe("no-cache");
		expect(await htmlResponse.text()).toContain("Pithos Graph Explorer");

		const cssResponse = await fetch(`${handle.url}/index.css`);
		expect(cssResponse.status).toBe(200);
		expect(cssResponse.headers.get("cache-control")).toBe("no-cache");

		const invalidGraphResponse = await fetch(`${handle.url}/api/graph?status=bogus`);
		expect(invalidGraphResponse.status).toBe(400);
		expect(await readResponseJson(invalidGraphResponse)).toEqual(
			expect.objectContaining({ code: "INVALID_REQUEST" }),
		);

		const incompleteRangeResponse = await fetch(
			`${handle.url}/api/graph?selector=${encodeURIComponent(`scope:${fixture.scopeId}`)}&since=${encodeURIComponent(dbTimestampToIso("2026-06-14 08:30:00"))}`,
		);
		expect(incompleteRangeResponse.status).toBe(400);
		const incompleteRangeJson = asJsonRecord(await readResponseJson(incompleteRangeResponse));
		expect(incompleteRangeJson.code).toBe("INVALID_REQUEST");
		expect(String(incompleteRangeJson.message)).toContain(
			"absolute time filtering requires both since and until",
		);

		const invertedRangeResponse = await fetch(
			`${handle.url}/api/graph?selector=${encodeURIComponent(`scope:${fixture.scopeId}`)}&since=${encodeURIComponent(dbTimestampToIso("2026-06-14 09:30:00"))}&until=${encodeURIComponent(dbTimestampToIso("2026-06-14 08:30:00"))}`,
		);
		expect(invertedRangeResponse.status).toBe(400);
		const invertedRangeJson = asJsonRecord(await readResponseJson(invertedRangeResponse));
		expect(invertedRangeJson.code).toBe("INVALID_REQUEST");
		expect(String(invertedRangeJson.message)).toContain(
			"until must be greater than or equal to since",
		);

		const invalidTaskPathResponse = await fetch(`${handle.url}/api/task/%E0%A4%A`);
		expect(invalidTaskPathResponse.status).toBe(400);
		expect(await readResponseJson(invalidTaskPathResponse)).toEqual(
			expect.objectContaining({ code: "INVALID_REQUEST" }),
		);
	});

	it("returns structured running daemon status when the pdx socket responds", async () => {
		const fixture = seedExplorerFixture();
		await startDaemonStatusServer(fixture.dataDir);

		const handle = await startGraphExplorer({
			pithosDbPath: fixture.dbPath,
			pdxDataDir: fixture.dataDir,
			host: "127.0.0.1",
			port: 0,
			initialSelector: { kind: "scope", scopeId: fixture.scopeId },
		});
		handles.push(handle);

		const daemonStatusResponse = await fetch(`${handle.url}/api/daemon/status`);
		expect(daemonStatusResponse.status).toBe(200);
		expect(await readResponseJson(daemonStatusResponse)).toEqual({
			status: "running",
			socketPath: join(fixture.dataDir, "pdx.sock"),
			maxAfk: 4,
			afkUsed: 2,
			registryEntries: 3,
			intakeSocketPath: join(fixture.dataDir, "intake.sock"),
			message: "pdx daemon status is reachable.",
		});
	});

	it("pushes websocket snapshots and supports selector changes", async () => {
		const fixture = seedExplorerFixture();
		const handle = await startGraphExplorer({
			pithosDbPath: fixture.dbPath,
			pdxDataDir: fixture.dataDir,
			host: "127.0.0.1",
			port: 0,
			initialSelector: { kind: "scope", scopeId: fixture.scopeId },
		});
		handles.push(handle);

		const websocket = new WebSocket(handle.url.replace("http://", "ws://") + "/ws/graph");
		await waitForOpen(websocket);
		websocket.send(
			JSON.stringify({
				kind: "subscribe",
				selector: `scope:${fixture.scopeId}`,
			}),
		);

		const initialMessages = await collectWebsocketMessages(websocket, [
			"snapshot",
			"daemon_status",
		]);
		const initialSnapshot = messageByKind(initialMessages, "snapshot");
		const initialDaemonStatus = messageByKind(initialMessages, "daemon_status");
		expect(initialSnapshot.snapshot.graph.graph.nodes.map((node) => node.id)).toEqual(
			expect.arrayContaining([fixture.rootTaskId, fixture.childTaskId]),
		);
		expect(initialDaemonStatus.daemonStatus.status).toBe("not_running");

		websocket.send(
			JSON.stringify({
				kind: "set_selector",
				selector: `task:${fixture.childTaskId}`,
			}),
		);
		const nextSnapshotMessages = await collectWebsocketMessages(websocket, ["snapshot"]);
		expect(messageByKind(nextSnapshotMessages, "snapshot").snapshot.selector).toEqual({
			kind: "task",
			taskId: fixture.childTaskId,
		});

		rmSync(fixture.dbPath, { force: true });
		websocket.send(JSON.stringify({ kind: "refresh" }));
		const staleMessages = await collectWebsocketMessages(websocket, ["stale"]);
		const staleMessage = messageByKind(staleMessages, "stale");
		expect(staleMessage.kind).toBe("stale");
		expect(staleMessage.message).toContain("Graph snapshot refresh failed");
		expect(typeof staleMessage.lastSuccessAt).toBe("string");

		websocket.close();
	});

	it("reports unreachable daemon status when the socket path exists but is not a daemon socket", async () => {
		const fixture = seedExplorerFixture();
		writeFileSync(join(fixture.dataDir, "pdx.sock"), "not-a-socket");

		const handle = await startGraphExplorer({
			pithosDbPath: fixture.dbPath,
			pdxDataDir: fixture.dataDir,
			host: "127.0.0.1",
			port: 0,
			initialSelector: { kind: "scope", scopeId: fixture.scopeId },
		});
		handles.push(handle);

		const daemonStatusResponse = await fetch(`${handle.url}/api/daemon/status`);
		expect(daemonStatusResponse.status).toBe(200);
		expect(await readResponseJson(daemonStatusResponse)).toEqual(
			expect.objectContaining({
				status: "unreachable",
				socketPath: join(fixture.dataDir, "pdx.sock"),
			}),
		);
	});
});
