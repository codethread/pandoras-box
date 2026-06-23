import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { PdxError } from "../src/errors.js";
import { Clock, Ids, makeRegistry, Process, SupervisorLog } from "../src/services.js";
import { PANDORA_TARGET, isAfkAlive } from "../src/controller.js";
import {
	run,
	parseConfig,
	runOutput,
	makePithos,
	makeSpawner,
	upsertPandora,
	fakeProcess,
	fakeTmux,
	runTick,
} from "./support.js";

describe("pdx reconcile liveness and cleanup", () => {
	it("AFK liveness probe delegates to process kill-zero boundary", async () => {
		const liveProcess = fakeProcess();
		const deadProcess = fakeProcess({ isAlive: () => Effect.succeed(false) });
		await expect(
			run(isAfkAlive(123).pipe(Effect.provideService(Process, liveProcess))),
		).resolves.toBe(true);
		await expect(
			run(isAfkAlive(456).pipe(Effect.provideService(Process, deadProcess))),
		).resolves.toBe(false);
	});

	it("reconcile prunes on startup and then hourly cadence only", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const calls: string[] = [];
		const pithos = makePithos(calls, [], {
			pruneEvents: () =>
				Effect.sync(() => {
					calls.push("pruneEvents");
					return { ok: true as const, deleted_heartbeat: 1, deleted_other: 0 };
				}),
		});
		const logs: { readonly span: string; readonly msg: string }[] = [];
		const log = SupervisorLog.of({
			write: (record) =>
				Effect.sync(() => {
					logs.push({ span: record.span, msg: record.msg });
					return { ts: "now", ...record };
				}),
		});
		const config = await parseConfig(dataDir);
		const runTickAt = (nowIso: string) =>
			runTick({
				config,
				registry,
				pithos,
				ids: Ids.of({
					nextRunId: Effect.succeed("run_unused"),
					nextSessionId: Effect.succeed("session_unused"),
				}),
				log,
				clock: Clock.of({ nowIso: Effect.succeed(nowIso) }),
			});
		await runTickAt("2026-05-09T00:00:00.000Z");
		await runTickAt("2026-05-09T00:59:59.000Z");
		await runTickAt("2026-05-09T01:00:00.000Z");
		expect(calls.filter((call) => call === "pruneEvents")).toHaveLength(2);
		expect(
			logs.filter(
				(record) => record.span === "pdx.maintenance" && record.msg === "event prune completed",
			),
		).toHaveLength(2);
	});

	it("reconcile cleans dead Pandora and respawns with a fresh run id", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(
			registry.upsert({
				runId: "run_old",
				agent: "pandora",
				scopeId: "global",
				mode: "hitl",
				state: "live",
				logicalName: PANDORA_TARGET,
				tmuxTarget: PANDORA_TARGET,
			}),
		);
		const pithosCalls: string[] = [];
		const pithos = makePithos(pithosCalls);
		const ids = Ids.of({
			nextRunId: Effect.succeed("run_new"),
			nextSessionId: Effect.succeed("session_new"),
		});
		const spawner = makeSpawner({
			launchAgent: (input) =>
				Effect.succeed({
					...input,
					logicalName: PANDORA_TARGET,
					hitl: { tmuxTarget: PANDORA_TARGET, panePid: 123 },
				}),
		});
		const tmux = fakeTmux({ hasSession: () => Effect.succeed(false) });
		const config = await parseConfig(dataDir);
		await runTick({ config, registry, pithos, ids, spawner, tmux });
		const entries = await run(registry.list);
		expect(entries.map((entry) => entry.runId)).toEqual(["run_new"]);
		expect(pithosCalls).toContain("runCleanup:run_old:natural_death");
	});

	it("kills a leftover HITL tmux session when the tracked pane pid is dead", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-hitl-pane-death-"));
		const registry = await run(makeRegistry);
		await run(
			registry.upsert({
				runId: "run_old",
				agent: "pandora",
				scopeId: "global",
				mode: "hitl",
				state: "live",
				logicalName: PANDORA_TARGET,
				tmuxTarget: PANDORA_TARGET,
				panePid: 123,
			}),
		);
		const pithosCalls: string[] = [];
		const pithos = makePithos(pithosCalls);
		const ids = Ids.of({
			nextRunId: Effect.succeed("run_new"),
			nextSessionId: Effect.succeed("session_new"),
		});
		const spawner = makeSpawner({
			launchAgent: (input) =>
				Effect.succeed({
					...input,
					logicalName: PANDORA_TARGET,
					hitl: { tmuxTarget: PANDORA_TARGET, panePid: 456 },
				}),
		});
		let sessionExists = true;
		const killedTargets: string[] = [];
		const tmux = fakeTmux({
			hasSession: () => Effect.succeed(sessionExists),
			killSession: (target) =>
				Effect.sync(() => {
					killedTargets.push(target);
					sessionExists = false;
				}),
		});
		const config = await parseConfig(dataDir);
		await runTick({
			config,
			registry,
			pithos,
			ids,
			spawner,
			tmux,
			process: fakeProcess({ isAlive: () => Effect.succeed(false) }),
		});
		expect(killedTargets).toEqual([PANDORA_TARGET]);
		expect(pithosCalls).toContain("runCleanup:run_old:natural_death");
		expect((await run(registry.list)).map((entry) => entry.runId)).toEqual(["run_new"]);
	});

	it("passes transcript evidence into AFK natural-death cleanup", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-natural-death-afk-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		await run(
			registry.upsert({
				runId: "run_dead",
				agent: "war",
				scopeId: "scope_repo",
				mode: "afk",
				state: "live",
				logicalName: "pdx--war",
				pid: 456,
			}),
		);
		const cleanupInputs: {
			readonly runId: string;
			readonly reason: string;
			readonly sessionEvidence?: string;
		}[] = [];
		const config = await parseConfig(dataDir);
		await runTick({
			config,
			registry,
			pithos: makePithos([], [], {
				runInspect: (input) =>
					Effect.succeed(
						runOutput({
							id: input.runId,
							agent: "war",
							mode: "afk",
							scope_id: "scope_repo",
							harness_kind: "pi",
							session_log_path: "/tmp/run_dead.jsonl",
						}),
					),
				runCleanup: (input) => Effect.sync(() => cleanupInputs.push(input)),
			}),
			ids: Ids.of({ nextRunId: Effect.succeed("r"), nextSessionId: Effect.succeed("s") }),
			spawner: makeSpawner({
				launchAgent: () =>
					Effect.fail(new PdxError({ code: "PROCESS_ERROR", message: "unexpected" })),
				renderSessionTranscript: () =>
					Effect.succeed(
						"[2026-06-07 06:29:11] ASSISTANT: ERROR: OpenAI API error (503): upstream timeout\n",
					),
			}),
			process: fakeProcess({ isAlive: () => Effect.succeed(false) }),
		});
		expect(cleanupInputs).toEqual([
			expect.objectContaining({
				runId: "run_dead",
				reason: "natural_death",
				sessionEvidence:
					"[2026-06-07 06:29:11] ASSISTANT: ERROR: OpenAI API error (503): upstream timeout",
			}),
		]);
	});

	it("records transcript-render failures as explicit natural-death session evidence", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-natural-death-fallback-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		await run(
			registry.upsert({
				runId: "run_dead",
				agent: "war",
				scopeId: "scope_repo",
				mode: "afk",
				state: "live",
				logicalName: "pdx--war",
				pid: 456,
			}),
		);
		const cleanupInputs: { readonly sessionEvidence?: string }[] = [];
		const config = await parseConfig(dataDir);
		await runTick({
			config,
			registry,
			pithos: makePithos([], [], {
				runInspect: (input) =>
					Effect.succeed(
						runOutput({
							id: input.runId,
							agent: "war",
							mode: "afk",
							scope_id: "scope_repo",
							harness_kind: "pi",
							session_log_path: "/tmp/run_dead.jsonl",
						}),
					),
				runCleanup: (input) => Effect.sync(() => cleanupInputs.push(input)),
			}),
			ids: Ids.of({ nextRunId: Effect.succeed("r"), nextSessionId: Effect.succeed("s") }),
			spawner: makeSpawner({
				launchAgent: () =>
					Effect.fail(new PdxError({ code: "PROCESS_ERROR", message: "unexpected" })),
				renderSessionTranscript: () =>
					Effect.fail(new PdxError({ code: "HARNESS_ERROR", message: "missing transcript" })),
			}),
			process: fakeProcess({ isAlive: () => Effect.succeed(false) }),
		});
		expect(cleanupInputs).toEqual([
			expect.objectContaining({
				sessionEvidence: "Session evidence unavailable: missing transcript",
			}),
		]);
	});
});
