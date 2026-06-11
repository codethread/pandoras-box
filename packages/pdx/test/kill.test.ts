import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Ref } from "effect";
import { PdxError } from "../src/errors.js";
import {
	Ids,
	makeRegistry,
	PithosClient,
	Process,
	Registry,
	SupervisorLog,
	Tmux,
	type PithosClientService,
} from "../src/services.js";
import {
	PANDORA_TARGET,
	PDX_SYSTEM_RUN_ID,
	handleKillRequest,
	loggedReconcileTick,
} from "../src/controller.js";
import {
	run,
	parseConfig,
	runOutput,
	makePithos,
	alwaysLiveTmux,
	makeSpawner,
	upsertPandora,
	fakeProcess,
	runTick,
} from "./support.js";

describe("pdx kill", () => {
	it("daemon kill uses interrupted run details for escalation and resource kill", async () => {
		const registry = await run(makeRegistry);
		await run(
			registry.upsert({
				runId: "run_old_owner",
				agent: "greed",
				scopeId: "scope_repo",
				mode: "afk",
				state: "live",
				logicalName: "pdx--greed-old",
				pid: 123,
			}),
		);
		await run(
			registry.upsert({
				runId: "run_new_owner",
				agent: "greed",
				scopeId: "scope_repo",
				mode: "afk",
				state: "live",
				logicalName: "pdx--greed",
				pid: 321,
			}),
		);
		const calls: string[] = [];
		const pithos = makePithos(calls, [], {
			activeRunForTask: () =>
				Effect.succeed(
					runOutput({
						id: "run_old_owner",
						agent: "greed",
						mode: "afk",
						scope_id: "scope_repo",
						task_id: "task_held",
						session_id: "session_old",
					}),
				),
			runInterrupt: () =>
				Effect.succeed({
					run: runOutput({
						id: "run_new_owner",
						agent: "greed",
						mode: "afk",
						scope_id: "scope_repo",
						status: "failed",
						session_id: "session_new",
					}),
					interruptedTask: { id: "task_held", scope_id: "scope_repo" },
				}),
		});
		const kills: string[] = [];
		const process = fakeProcess({
			kill: (pid, signal) => Effect.sync(() => kills.push(`${pid}:${signal}`)),
		});
		await run(
			handleKillRequest({ run: undefined, task: "task_held", reason: "operator stop" }).pipe(
				Effect.provideService(Registry, registry),
				Effect.provideService(PithosClient, pithos),
				Effect.provideService(Process, process),
				Effect.provideService(Tmux, alwaysLiveTmux),
			),
		);
		expect(kills).toEqual(["321:SIGTERM"]);
		expect(await run(registry.list)).toContainEqual(
			expect.objectContaining({ runId: "run_new_owner", state: "terminating" }),
		);
	});

	it("daemon kill rejects non-held task with cancel guidance", async () => {
		const registry = await run(makeRegistry);
		const pithos = makePithos([], [], { activeRunForTask: () => Effect.succeed(null) });
		await expect(
			run(
				handleKillRequest({ run: undefined, task: "task_idle", reason: "stop" }).pipe(
					Effect.provideService(Registry, registry),
					Effect.provideService(PithosClient, pithos),
				),
			),
		).rejects.toThrow(/pithos task cancel/);
	});

	it("daemon kill rejects missing runs loudly", async () => {
		const registry = await run(makeRegistry);
		const pithos = makePithos([], [], {
			runInspect: () =>
				Effect.fail(new PdxError({ code: "NOT_FOUND", message: "run not found: run_missing" })),
		});
		await expect(
			run(
				handleKillRequest({ run: "run_missing", task: undefined, reason: "stop" }).pipe(
					Effect.provideService(Registry, registry),
					Effect.provideService(PithosClient, pithos),
				),
			),
		).rejects.toThrow(/run not found/);
	});

	it("daemon kill rejects terminal runs before interrupting", async () => {
		const registry = await run(makeRegistry);
		const calls: string[] = [];
		const pithos = makePithos(calls, [], {
			runInspect: () =>
				Effect.succeed(
					runOutput({
						id: "run_done",
						agent: "greed",
						mode: "afk",
						scope_id: "scope_repo",
						status: "ended",
						session_id: "session_done",
					}),
				),
		});
		await expect(
			run(
				handleKillRequest({ run: "run_done", task: undefined, reason: "stop" }).pipe(
					Effect.provideService(Registry, registry),
					Effect.provideService(PithosClient, pithos),
				),
			),
		).rejects.toThrow(/terminal/);
		expect(calls).not.toContain("runInterrupt:run_done:stop");
	});

	it("kill retry keeps terminating entry until resource is gone", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(
			registry.upsert({
				runId: "run_pandora",
				agent: "pandora",
				scopeId: "global",
				mode: "hitl",
				state: "live",
				logicalName: PANDORA_TARGET,
				tmuxTarget: PANDORA_TARGET,
			}),
		);
		await run(
			registry.upsert({
				runId: "run_kill",
				agent: "greed",
				scopeId: "scope_repo",
				mode: "afk",
				state: "terminating",
				logicalName: "pdx--greed",
				pid: 123,
				killAttempts: 1,
			}),
		);
		const kills: string[] = [];
		let aliveProbe = 0;
		const process = fakeProcess({
			isAlive: () => Effect.succeed(aliveProbe++ === 0),
			kill: (_pid, signal) =>
				Effect.sync(() => kills.push(signal)).pipe(
					Effect.zipRight(
						Effect.fail(new PdxError({ code: "PROCESS_ERROR", message: "kill failed" })),
					),
				),
		});
		const logs: string[] = [];
		const log = SupervisorLog.of({
			write: (record) =>
				Effect.sync(() => {
					logs.push(record.span);
					return { ts: "now", ...record };
				}),
		});
		const config = await parseConfig(dataDir);
		const tick = () =>
			runTick({
				config,
				registry,
				pithos: makePithos([]),
				process,
				log,
				ids: Ids.of({
					nextRunId: Effect.succeed("run_unused"),
					nextSessionId: Effect.succeed("session_unused"),
				}),
			});
		await tick();
		expect(kills).toEqual(["SIGKILL"]);
		expect(await run(registry.list)).toContainEqual(
			expect.objectContaining({ runId: "run_kill", state: "terminating" }),
		);
		await tick();
		expect(await run(registry.list)).toEqual([expect.objectContaining({ runId: "run_pandora" })]);
		expect(logs).toContain("pdx.kill.retry");
		expect(logs).toContain("pdx.kill");
	});

	it("kill retry escalates to Pandora at kill threshold", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		await run(
			registry.upsert({
				runId: "run_kill",
				agent: "war",
				scopeId: "scope_wt",
				mode: "afk",
				state: "terminating",
				logicalName: "pdx--war",
				pid: 456,
				killAttempts: 2,
				interruptedTaskId: "task_held",
				killReason: "operator stop",
			}),
		);
		const createRepairAlertCalls: Parameters<PithosClientService["createRepairAlert"]>[0][] = [];
		const pithos = makePithos([], [], {
			createRepairAlert: (input) =>
				Effect.sync(() => {
					createRepairAlertCalls.push(input);
				}),
		});
		const config = await parseConfig(dataDir);
		await runTick({
			config,
			registry,
			pithos,
			ids: Ids.of({
				nextRunId: Effect.succeed("run_unused"),
				nextSessionId: Effect.succeed("session_unused"),
			}),
		});
		expect(createRepairAlertCalls).toHaveLength(1);
		expect(createRepairAlertCalls[0]).toMatchObject({
			runId: PDX_SYSTEM_RUN_ID,
			kind: "kill_failure",
		});
		expect(createRepairAlertCalls[0]?.escalationTitle).toContain("run_kill");
		expect(createRepairAlertCalls[0]?.escalationBody).toContain("Run: run_kill");
		expect(createRepairAlertCalls[0]?.escalationBody).toContain("PID: 456");
		expect(createRepairAlertCalls[0]?.escalationBody).toContain("Interrupted task: task_held");
		expect(createRepairAlertCalls[0]?.escalationBody).toContain("Kill reason: operator stop");
		expect(await run(registry.list)).toContainEqual(
			expect.objectContaining({ runId: "run_kill", state: "terminating", killAttempts: 3 }),
		);
	});

	it("kill retry does not re-escalate after successful escalation", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		await run(
			registry.upsert({
				runId: "run_kill",
				agent: "war",
				scopeId: "scope_wt",
				mode: "afk",
				state: "terminating",
				logicalName: "pdx--war",
				pid: 456,
				killAttempts: 3,
				killEscalated: true,
			}),
		);
		const taskEnqueueCalls: Parameters<PithosClientService["taskEnqueue"]>[0][] = [];
		const pithos = makePithos([], [], {
			taskEnqueue: (input) =>
				Effect.sync(() => {
					taskEnqueueCalls.push(input);
				}),
		});
		const config = await parseConfig(dataDir);
		await runTick({
			config,
			registry,
			pithos,
			ids: Ids.of({
				nextRunId: Effect.succeed("run_unused"),
				nextSessionId: Effect.succeed("session_unused"),
			}),
		});
		expect(taskEnqueueCalls.filter((c) => c.capability === "escalate")).toHaveLength(0);
		expect(await run(registry.list)).toContainEqual(
			expect.objectContaining({ runId: "run_kill", killAttempts: 4 }),
		);
	});

	it("loggedReconcileTick enqueues escalation when stopping due to kill-confirm failure", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		// afk entry past no-claim timeout; process refuses to die after kill → "still alive after kill"
		await run(
			registry.upsert({
				runId: "run_stuck",
				agent: "war",
				scopeId: "scope_wt",
				mode: "afk",
				state: "live",
				logicalName: "pdx--war",
				pid: 789,
				launchedAt: "2026-05-09T00:00:00.000Z",
				everClaimed: false,
			}),
		);
		const createRepairAlertCalls: Parameters<PithosClientService["createRepairAlert"]>[0][] = [];
		const pithos = makePithos([], [], {
			createRepairAlert: (input) =>
				Effect.sync(() => {
					createRepairAlertCalls.push(input);
				}),
			runTimeout: () => Effect.void,
		});
		const config = await parseConfig(dataDir);
		const consecutiveFailures = await run(Ref.make(0));
		const tick = () =>
			runTick({
				config,
				registry,
				pithos,
				ids: Ids.of({
					nextRunId: Effect.succeed("run_unused"),
					nextSessionId: Effect.succeed("session_unused"),
				}),
				spawner: makeSpawner({
					launchAgent: () =>
						Effect.fail(new PdxError({ code: "PROCESS_ERROR", message: "unexpected launch" })),
				}),
				tickEffect: (cfg) => loggedReconcileTick(cfg, 4, consecutiveFailures),
			});
		// First two ticks fail but do not stop the reconciler.
		await tick();
		await tick();
		// Third tick reaches max — reconciler stops and enqueues the kill-confirm escalation.
		await expect(tick()).rejects.toThrow("still alive after kill");
		const escalation = createRepairAlertCalls.find((c) => c.kind === "reconciler_stuck");
		expect(escalation).toBeDefined();
		expect(escalation?.escalationTitle).toBe("pdx reconciler stopped: kill confirmation failed");
		expect(escalation?.escalationBody).toContain("still alive after kill");
	});
});
