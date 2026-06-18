import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
	Clock,
	FileSystem,
	Ids,
	LifecycleReporter,
	makeRegistry,
	PithosClient,
	Process,
	Registry,
	RepoLaunchChecks,
	Spawner,
	SupervisorLog,
	Tmux,
	type LaunchAgentResult,
} from "../src/services.js";
import { makePithosClientLive } from "../src/live.js";
import { makeEngine } from "@pdx/pithos";
import {
	PANDORA_TARGET,
	PDX_SYSTEM_RUN_ID,
	handleKillRequest,
	reconcileTick,
} from "../src/controller.js";
import {
	run,
	parseConfig,
	alwaysLiveTmux,
	alwaysLiveProcess,
	testLog,
	testLifecycle,
	testClock,
	noopFs,
	pithosTestServices,
	makeSpawner,
	fakeProcess,
	fakeRepoLaunchChecks,
} from "./support.js";

describe("pdx pithos integration and registry", () => {
	it("integrates real Pithos state with pdx reconcile spawning and agent claims", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-integration-"));
		const config = await parseConfig(dataDir);
		const engine = makeEngine({
			config: { dbPath: config.pithosDbPath, runId: undefined },
			services: pithosTestServices(),
		});
		engine.init({ fresh: true });
		const repo = engine.scopeUpsert({ kind: "repo", path: dataDir }).scope.id;
		engine.runUpsert({
			agent: "pdx",
			mode: "afk",
			scope: "global",
			cwd: dataDir,
			sessionId: "pdx-system",
			harnessKind: "system",
			sessionLogPath: config.logPath,
			runId: PDX_SYSTEM_RUN_ID,
		});
		engine.runUpsert({
			agent: "pandora",
			mode: "hitl",
			scope: "global",
			cwd: dataDir,
			sessionId: "pandora-seed",
			harnessKind: "pi",
			sessionLogPath: join(dataDir, "pandora-seed.jsonl"),
			runId: "run_pandora_seed",
		});
		engine.enqueue({
			scope: repo,
			capability: "triage",
			title: "triage feature",
			body: "break down the feature",
			bodyFile: undefined,
			runId: "run_pandora_seed",
			after: [],
			chain: "auto",
		});
		const registry = await run(makeRegistry);
		const launches: LaunchAgentResult[] = [];
		const spawner = makeSpawner({
			launchAgent: (launch) =>
				Effect.sync(() => {
					const result =
						launch.mode === "hitl"
							? {
									...launch,
									logicalName: PANDORA_TARGET,
									hitl: { tmuxTarget: PANDORA_TARGET, panePid: 100 },
								}
							: {
									...launch,
									logicalName: `pdx--${launch.agent}`,
									afk: { pid: 200 + launches.length, processStartTime: "2026-05-09T00:00:00.000Z" },
								};
					launches.push({
						...result,
						harnessKind: "pi",
						sessionLogPath: `/tmp/${launch.runId}.jsonl`,
					});
					return result;
				}),
		});
		const ids = Ids.of({
			nextRunId: Effect.sync(() => `run_spawn_${launches.length + 1}`),
			nextSessionId: Effect.sync(() => `123e4567-e89b-42d3-a456-42661417400${launches.length}`),
		});
		await run(
			reconcileTick(config).pipe(
				Effect.provideService(Registry, registry),
				Effect.provideService(PithosClient, makePithosClientLive(config.pithosDbPath)),
				Effect.provideService(Spawner, spawner),
				Effect.provideService(Ids, ids),
				Effect.provideService(Tmux, alwaysLiveTmux),
				Effect.provideService(Process, alwaysLiveProcess),
				Effect.provideService(RepoLaunchChecks, fakeRepoLaunchChecks()),
				Effect.provideService(SupervisorLog, testLog),
				Effect.provideService(LifecycleReporter, testLifecycle),
				Effect.provideService(FileSystem, noopFs),
				Effect.provideService(Clock, testClock),
			),
		);
		expect(launches.map((launch) => launch.agent)).toEqual(["pandora", "toil"]);
		const entries = await run(registry.list);
		expect(entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ agent: "pandora", state: "live" }),
				expect.objectContaining({ agent: "toil", state: "live", scopeId: repo }),
			]),
		);
		const toilRun = launches.find((launch) => launch.agent === "toil");
		expect(toilRun).toBeDefined();
		if (toilRun === undefined) throw new Error("toil launch missing");
		const claimed = engine.claim({ runId: toilRun.runId, scope: repo, capability: "triage" });
		expect(claimed.task.status).toBe("claimed");
		expect(engine.runInspect({ runId: toilRun.runId }).run.task_id).toBe(claimed.task.id);
	});

	it("integrates pdx kill with real Pithos interrupt and escalation enqueue", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-kill-integration-"));
		const config = await parseConfig(dataDir);
		const engine = makeEngine({
			config: { dbPath: config.pithosDbPath, runId: undefined },
			services: pithosTestServices(),
		});
		engine.init({ fresh: true });
		const repo = engine.scopeUpsert({ kind: "repo", path: dataDir }).scope.id;
		engine.runUpsert({
			agent: "pdx",
			mode: "afk",
			scope: "global",
			cwd: dataDir,
			sessionId: "pdx-system",
			harnessKind: "system",
			sessionLogPath: config.logPath,
			runId: PDX_SYSTEM_RUN_ID,
		});
		engine.runUpsert({
			agent: "toil",
			mode: "afk",
			scope: "global",
			cwd: dataDir,
			sessionId: "toil-session",
			harnessKind: "pi",
			sessionLogPath: join(dataDir, "toil.jsonl"),
			runId: "run_toil",
		});
		engine.runUpsert({
			agent: "war",
			mode: "afk",
			scope: repo,
			cwd: dataDir,
			sessionId: "war-session",
			harnessKind: "pi",
			sessionLogPath: join(dataDir, "war.jsonl"),
			runId: "run_war",
		});
		engine.runUpsert({
			agent: "pandora",
			mode: "hitl",
			scope: "global",
			cwd: dataDir,
			sessionId: "pandora-session",
			harnessKind: "pi",
			sessionLogPath: join(dataDir, "pandora.jsonl"),
			runId: "run_pandora_for_kill",
		});
		const enqueued = engine.enqueue({
			scope: repo,
			capability: "execute",
			title: "execute",
			body: "do work",
			bodyFile: undefined,
			runId: "run_toil",
			after: [],
			chain: "auto",
		});
		const claimed = engine.claim({ runId: "run_war", scope: repo, capability: "execute" });
		expect(claimed.task.id).toBe(enqueued.task.id);
		const registry = await run(makeRegistry);
		await run(
			registry.upsert({
				runId: "run_war",
				agent: "war",
				scopeId: repo,
				mode: "afk",
				state: "live",
				logicalName: "pdx--war",
				pid: 333,
				everClaimed: true,
			}),
		);
		const kills: string[] = [];
		const process = fakeProcess({
			kill: (pid, signal) => Effect.sync(() => kills.push(`${pid}:${signal}`)),
		});
		await run(
			handleKillRequest({ run: "run_war", task: undefined, reason: "bad edit" }).pipe(
				Effect.provideService(Registry, registry),
				Effect.provideService(PithosClient, makePithosClientLive(config.pithosDbPath)),
				Effect.provideService(Process, process),
				Effect.provideService(Tmux, alwaysLiveTmux),
			),
		);
		expect(kills).toEqual(["333:SIGTERM"]);
		expect(engine.runInspect({ runId: "run_war" }).run.status).toBe("failed");
		expect(engine.taskInspect({ taskId: enqueued.task.id }).task.status).toBe("failed");
		const escalation = engine.claim({
			runId: "run_pandora_for_kill",
			scope: "global",
			capability: "escalate",
		});
		expect(escalation.task.status).toBe("claimed");
	});

	it("starts registry empty and supports typed operations", async () => {
		const registryContext = await run(makeRegistry);
		const listEmpty = await run(
			Registry.pipe(
				Effect.flatMap((registry) => registry.list),
				Effect.provideService(Registry, registryContext),
			),
		);
		expect(listEmpty).toEqual([]);
		expect(await run(registryContext.lastEscalateClaimableCount)).toBe(0);
		await run(
			Registry.pipe(
				Effect.flatMap((registry) =>
					registry.upsert({
						runId: "run_1",
						agent: "war",
						scopeId: "scope_1",
						mode: "afk",
						state: "live",
						logicalName: "pdx--war",
					}),
				),
				Effect.provideService(Registry, registryContext),
			),
		);
		const entries = await run(
			Registry.pipe(
				Effect.flatMap((registry) => registry.list),
				Effect.provideService(Registry, registryContext),
			),
		);
		expect(entries).toHaveLength(1);
	});
});
