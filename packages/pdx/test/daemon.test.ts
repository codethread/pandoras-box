import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { PdxError } from "../src/errors.js";
import { parseIpcRequest } from "../src/ipc.js";
import { listenIpc, requestIpc } from "../src/ipc-socket.js";
import {
	Clock,
	FileSystem,
	Ids,
	LifecycleReporter,
	makeRegistry,
	PithosClient,
	Process,
	Registry,
	Spawner,
	SupervisorLog,
	Tmux,
	type PithosClientService,
} from "../src/services.js";
import {
	DAEMON_TARGET,
	PANDORA_TARGET,
	openPdx,
	PDX_SYSTEM_RUN_ID,
	runDaemon,
} from "../src/controller.js";
import {
	run,
	parseConfig,
	makePithos,
	alwaysLiveTmux,
	alwaysLiveProcess,
	testLog,
	testLifecycle,
	testClock,
	noopFs,
	makeSpawner,
	fakeTmux,
	fakeProcess,
	fakeFs,
} from "./support.js";

describe("pdx open and daemon lifecycle", () => {
	it("rejects malformed and unknown IPC requests loudly", async () => {
		await expect(run(parseIpcRequest("{"))).rejects.toThrow(/Malformed IPC request JSON/);
		await expect(run(parseIpcRequest(JSON.stringify({ kind: "kill" })))).rejects.toThrow(
			/Invalid IPC request/,
		);
		await expect(run(parseIpcRequest(JSON.stringify({ kind: "ping" })))).resolves.toEqual({
			kind: "ping",
		});
	});

	it("open rejects when daemon tmux session already exists", async () => {
		const tmux = fakeTmux();
		const fs = fakeFs();
		const pithos = makePithos();
		await expect(
			run(
				openPdx(await parseConfig("/tmp/pdx-home"), 4, 5, { clean: false, nuke: false }).pipe(
					Effect.provideService(Tmux, tmux),
					Effect.provideService(FileSystem, fs),
					Effect.provideService(Clock, testClock),
					Effect.provideService(PithosClient, pithos),
				),
			),
		).rejects.toThrow(`${DAEMON_TARGET} already exists`);
	});

	it("open starts daemon tmux session with configured entrypoint", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const config = await parseConfig(dataDir);
		let commandInput:
			| { readonly target: string; readonly cwd: string; readonly command: readonly string[] }
			| undefined;
		const tmux = fakeTmux({
			hasSession: () => Effect.succeed(false),
			newSession: (input) =>
				Effect.sync(() => {
					commandInput = input;
				}),
		});
		const fs = fakeFs();
		const pithos = makePithos();
		const spawner = makeSpawner({ launchAgent: () => Effect.die("unexpected launch") });
		const server = await run(
			listenIpc(config.socketPath, () => Effect.succeed({ ok: true, data: { ready: true } })),
		);
		try {
			await run(
				openPdx(config, 4, 5, { clean: false, nuke: false }).pipe(
					Effect.provideService(Tmux, tmux),
					Effect.provideService(FileSystem, fs),
					Effect.provideService(Clock, testClock),
					Effect.provideService(PithosClient, pithos),
					Effect.provideService(Spawner, spawner),
				),
			);
		} finally {
			await run(server.close);
		}
		expect(commandInput).toEqual({
			target: DAEMON_TARGET,
			cwd: config.dataDir,
			command: [
				config.daemonEntrypoint,
				"daemon",
				"run",
				"--data-dir",
				config.dataDir,
				"--max-afk",
				"4",
				"--interval-seconds",
				"5",
			],
		});
	});

	it("open --clean wipes runtime state only (DB, runs, logs) before starting", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const parsed = await parseConfig(dataDir);
		const socketDir = await mkdtemp(join(tmpdir(), "pdx-clean-socket-"));
		const config = {
			...parsed,
			socketPath: join(socketDir, "pdx.sock"),
			intakeSocketPath: join(socketDir, "intake.sock"),
		};
		const removes: string[] = [];
		const tmux = fakeTmux({ hasSession: () => Effect.succeed(false) });
		const fs = fakeFs({ removeFile: (path) => Effect.sync(() => removes.push(path)) });
		const pithos = makePithos();
		const spawner = makeSpawner({ launchAgent: () => Effect.die("unexpected launch") });
		const server = await run(
			listenIpc(config.socketPath, () => Effect.succeed({ ok: true, data: { ready: true } })),
		);
		try {
			await run(
				openPdx(config, 4, 5, { clean: true, nuke: false }).pipe(
					Effect.provideService(Tmux, tmux),
					Effect.provideService(FileSystem, fs),
					Effect.provideService(Clock, testClock),
					Effect.provideService(PithosClient, pithos),
					Effect.provideService(Spawner, spawner),
				),
			);
		} finally {
			await run(server.close);
		}
		expect(removes).toEqual([
			config.pithosDbPath,
			config.runsDir,
			config.logPath,
			config.socketPath,
			config.intakeSocketPath,
		]);
	});

	it("daemon startup creates runs dir, system run, Pandora singleton, and excludes pdx from caps", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const mkdirs: string[] = [];
		const pithosCalls: string[] = [];
		const runUpsertInputs: Parameters<PithosClientService["runUpsert"]>[0][] = [];
		const fs = fakeFs({ mkdir: (path) => Effect.sync(() => mkdirs.push(path)) });
		const pithos = makePithos(
			pithosCalls,
			[{ scope_id: "global", capability: "triage", scope_kind: "global", canonical_path: null }],
			{
				runUpsert: (input) =>
					Effect.sync(() => {
						runUpsertInputs.push(input);
						pithosCalls.push(`runUpsert:${input.agent}:${input.runId ?? "new"}`);
					}),
			},
		);
		const log = SupervisorLog.of({ write: (record) => Effect.succeed({ ts: "now", ...record }) });
		const registry = await run(makeRegistry);
		const runIds = ["run_pandora_1", "run_toil_1"];
		const sessionIds = ["session_pandora_1", "session_toil_1"];
		const ids = Ids.of({
			nextRunId: Effect.sync(() => runIds.shift() ?? "run_unexpected"),
			nextSessionId: Effect.sync(() => sessionIds.shift() ?? "session_unexpected"),
		});
		const spawner = makeSpawner({
			launchAgent: (input) =>
				Effect.succeed(
					input.agent === "pandora"
						? {
								...input,
								logicalName: PANDORA_TARGET,
								hitl: { tmuxTarget: PANDORA_TARGET, panePid: 123 },
							}
						: {
								...input,
								logicalName: "pdx--toil",
								afk: { pid: 123, processStartTime: "now" },
							},
				),
		});
		const tmux = fakeTmux();
		const process = fakeProcess();
		const config = await parseConfig(dataDir);
		const handle = await run(
			runDaemon(config, 1, 5).pipe(
				Effect.provideService(FileSystem, fs),
				Effect.provideService(Clock, testClock),
				Effect.provideService(PithosClient, pithos),
				Effect.provideService(SupervisorLog, log),
				Effect.provideService(LifecycleReporter, testLifecycle),
				Effect.provideService(Registry, registry),
				Effect.provideService(Ids, ids),
				Effect.provideService(Spawner, spawner),
				Effect.provideService(Tmux, tmux),
				Effect.provideService(Process, process),
			),
		);
		await run(handle.close);
		expect(mkdirs).toEqual([`${dataDir}/runs`]);
		expect(pithosCalls).toContain("scopeUpsert:global");
		expect(pithosCalls).toContain(`runUpsert:pdx:${PDX_SYSTEM_RUN_ID}`);
		expect(pithosCalls).toContain("runUpsert:pandora:run_pandora_1");
		expect(pithosCalls).toContain("runUpsert:toil:run_toil_1");
		expect(runUpsertInputs).toContainEqual({
			agent: "pdx",
			mode: "afk",
			scope: "global",
			cwd: config.dataDir,
			sessionId: DAEMON_TARGET,
			harnessKind: "system",
			sessionLogPath: config.logPath,
			runId: PDX_SYSTEM_RUN_ID,
		});
		expect((await run(registry.list)).map((entry) => entry.agent)).not.toContain("pdx");
	});

	it("daemon startup prunes events on the initial reconcile tick", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const calls: string[] = [];
		const pithos = makePithos(calls, [], {
			pruneEvents: () =>
				Effect.sync(() => {
					calls.push("pruneEvents");
					return { ok: true as const, deleted_heartbeat: 7, deleted_other: 2 };
				}),
		});
		const logRecords: { readonly span: string; readonly msg: string; readonly data?: unknown }[] =
			[];
		const log = SupervisorLog.of({
			write: (record) =>
				Effect.sync(() => {
					logRecords.push(record);
					return { ts: "now", ...record };
				}),
		});
		const registry = await run(makeRegistry);
		const config = await parseConfig(dataDir);
		const handle = await run(
			runDaemon(config, 4, 5).pipe(
				Effect.provideService(FileSystem, noopFs),
				Effect.provideService(Clock, testClock),
				Effect.provideService(PithosClient, pithos),
				Effect.provideService(SupervisorLog, log),
				Effect.provideService(LifecycleReporter, testLifecycle),
				Effect.provideService(Registry, registry),
				Effect.provideService(
					Ids,
					Ids.of({
						nextRunId: Effect.succeed("run_pandora"),
						nextSessionId: Effect.succeed("session_pandora"),
					}),
				),
				Effect.provideService(
					Spawner,
					makeSpawner({
						launchAgent: (input) =>
							Effect.succeed({
								...input,
								logicalName: PANDORA_TARGET,
								hitl: { tmuxTarget: PANDORA_TARGET, panePid: 1 },
							}),
					}),
				),
				Effect.provideService(Tmux, alwaysLiveTmux),
				Effect.provideService(Process, alwaysLiveProcess),
			),
		);
		await run(handle.close);
		expect(calls).toContain("pruneEvents");
		expect(
			logRecords.some(
				(record) =>
					record.span === "pdx.maintenance" &&
					record.msg === "event prune completed" &&
					typeof record.data === "object" &&
					record.data !== null &&
					"deleted_heartbeat" in record.data &&
					"deleted_other" in record.data &&
					record.data.deleted_heartbeat === 7 &&
					record.data.deleted_other === 2,
			),
		).toBe(true);
	});

	it("daemon reports Pandora launch failures in lifecycle output before later ticks retry", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const records: { readonly level: string; readonly msg: string; readonly data?: unknown }[] = [];
		const lifecycleEvents: unknown[] = [];
		const log = SupervisorLog.of({
			write: (record) =>
				Effect.sync(() => {
					records.push(record);
					return { ts: "now", ...record };
				}),
		});
		const lifecycle = LifecycleReporter.of({
			report: (event) => Effect.sync(() => lifecycleEvents.push(event)),
		});
		const registry = await run(makeRegistry);
		const spawner = makeSpawner({
			launchAgent: () =>
				Effect.fail(new PdxError({ code: "PROCESS_ERROR", message: "tmux exploded" })),
		});
		const config = await parseConfig(dataDir);
		const handle = await run(
			runDaemon(config, 4, 5).pipe(
				Effect.provideService(FileSystem, noopFs),
				Effect.provideService(Clock, testClock),
				Effect.provideService(PithosClient, makePithos()),
				Effect.provideService(SupervisorLog, log),
				Effect.provideService(LifecycleReporter, lifecycle),
				Effect.provideService(Registry, registry),
				Effect.provideService(
					Ids,
					Ids.of({
						nextRunId: Effect.succeed("run_pandora_fail"),
						nextSessionId: Effect.succeed("session_pandora_fail"),
					}),
				),
				Effect.provideService(Spawner, spawner),
				Effect.provideService(Tmux, alwaysLiveTmux),
				Effect.provideService(Process, alwaysLiveProcess),
			),
		);
		await run(handle.close);
		expect(records).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					level: "error",
					msg: "reconcile tick failed",
					data: { error: "tmux exploded", attempt: 1, max_attempts: 3 },
				}),
				expect.objectContaining({ level: "info", msg: "daemon ready" }),
			]),
		);
		expect(lifecycleEvents).toEqual(
			expect.arrayContaining([
				{
					kind: "error",
					span: "pdx.reconcile",
					message: "tmux exploded",
					attempt: 1,
					maxAttempts: 3,
				},
			]),
		);
		expect(await run(registry.list)).toEqual([]);
	});

	it("daemon startup settles HITL and AFK orphans before creating system run", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const config = await parseConfig(dataDir);
		const events: string[] = [];
		const removes: string[] = [];
		const fs = fakeFs({
			readFile: (path) => Effect.succeed(path.endsWith("run_live.pid") ? "456\n" : "789\n"),
			readDirectory: () => Effect.succeed(["run_live.pid", "run_stale.pid", "note.txt"]),
			removeFile: (path) => Effect.sync(() => removes.push(path)),
		});
		const pithos = makePithos(events);
		const killedSessions: string[] = [];
		const tmux = fakeTmux({
			hasSession: (target) => Effect.succeed(!killedSessions.includes(target)),
			lsSessions: () => Effect.succeed([DAEMON_TARGET, "pdx--greed", "other"]),
			killSession: (target) =>
				Effect.sync(() => {
					events.push(`killSession:${target}`);
					killedSessions.push(target);
				}),
		});
		const killedPids: string[] = [];
		const process = fakeProcess({
			isAlive: (pid) => Effect.succeed(pid === 456 && !killedPids.includes("456:SIGKILL")),
			kill: (pid, signal) =>
				Effect.sync(() => {
					events.push(`kill:${pid}:${signal}`);
					killedPids.push(`${pid}:${signal}`);
				}),
		});
		const registry = await run(makeRegistry);
		const handle = await run(
			runDaemon(config, 4, 5).pipe(
				Effect.provideService(FileSystem, fs),
				Effect.provideService(Clock, testClock),
				Effect.provideService(PithosClient, pithos),
				Effect.provideService(SupervisorLog, testLog),
				Effect.provideService(LifecycleReporter, testLifecycle),
				Effect.provideService(Registry, registry),
				Effect.provideService(
					Ids,
					Ids.of({ nextRunId: Effect.succeed("run_pandora"), nextSessionId: Effect.succeed("s") }),
				),
				Effect.provideService(
					Spawner,
					makeSpawner({
						launchAgent: (input) =>
							Effect.succeed({
								...input,
								logicalName: PANDORA_TARGET,
								hitl: { tmuxTarget: PANDORA_TARGET, panePid: 1 },
							}),
					}),
				),
				Effect.provideService(Tmux, tmux),
				Effect.provideService(Process, process),
			),
		);
		await run(handle.close);
		expect(events.slice(0, 7)).toEqual([
			"killSession:pdx--greed",
			"kill:456:SIGTERM",
			"kill:456:SIGKILL",
			"runCleanup:run_live:daemon_start",
			"runCleanup:run_stale:daemon_start",
			"scopeUpsert:global",
			`runUpsert:pdx:${PDX_SYSTEM_RUN_ID}`,
		]);
		expect(events).not.toContain(`killSession:${DAEMON_TARGET}`);
		expect(events).not.toContain("kill:789:SIGTERM");
		expect(removes).toEqual([`${config.runsDir}/run_live.pid`, `${config.runsDir}/run_stale.pid`]);
	});

	it("daemon stop replies after cleanup and closes the IPC socket explicitly", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const pithosCalls: string[] = [];
		const removes: string[] = [];
		const fs = fakeFs({ removeFile: (path) => Effect.sync(() => removes.push(path)) });
		const pithos = makePithos(pithosCalls);
		const log = SupervisorLog.of({ write: (record) => Effect.succeed({ ts: "now", ...record }) });
		const registry = await run(makeRegistry);
		const ids = Ids.of({
			nextRunId: Effect.succeed("run_pandora_1"),
			nextSessionId: Effect.succeed("session_pandora_1"),
		});
		const spawner = makeSpawner({
			launchAgent: (input) =>
				Effect.succeed({
					...input,
					logicalName: PANDORA_TARGET,
					hitl: { tmuxTarget: PANDORA_TARGET, panePid: 123 },
				}),
		});
		const killed: string[] = [];
		const processKills: string[] = [];
		const process = fakeProcess({
			isAlive: (pid) => Effect.succeed(!processKills.includes(`${pid}:SIGKILL`)),
			kill: (pid, signal) => Effect.sync(() => processKills.push(`${pid}:${signal}`)),
		});
		const tmux = fakeTmux({
			hasSession: (target) => Effect.succeed(!killed.includes(target)),
			killSession: (target) => Effect.sync(() => killed.push(target)),
		});
		const config = await parseConfig(dataDir);
		const handle = await run(
			runDaemon(config, 4, 5).pipe(
				Effect.provideService(FileSystem, fs),
				Effect.provideService(Clock, testClock),
				Effect.provideService(PithosClient, pithos),
				Effect.provideService(SupervisorLog, log),
				Effect.provideService(LifecycleReporter, testLifecycle),
				Effect.provideService(Registry, registry),
				Effect.provideService(Ids, ids),
				Effect.provideService(Spawner, spawner),
				Effect.provideService(Tmux, tmux),
				Effect.provideService(Process, process),
			),
		);
		await run(
			registry.upsert({
				runId: "run_afk_close",
				agent: "war",
				scopeId: "scope_repo",
				mode: "afk",
				state: "live",
				logicalName: "pdx--war",
				pid: 456,
			}),
		);

		const response = await run(requestIpc(config.socketPath, { kind: "stop" }));
		await run(handle.shutdown);
		await run(handle.close);
		expect(response).toEqual({ ok: true, data: { stopped: true } });
		expect(processKills).toEqual(["456:SIGTERM", "456:SIGKILL"]);
		expect(pithosCalls).toContain("runCleanup:run_afk_close:pdx_close");
		expect(removes).toContain(`${config.runsDir}/run_afk_close.pid`);
		expect(pithosCalls.at(-1)).toEqual(`runCleanup:${PDX_SYSTEM_RUN_ID}:pdx_close`);
		expect(existsSync(config.socketPath)).toBe(false);
	});
});
