import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { PdxError } from "../src/errors.js";
import { Clock, FileSystem, Ids, makeRegistry } from "../src/services.js";
import { FileSystemLive } from "../src/live.js";
import { PANDORA_TARGET } from "../src/controller.js";
import {
	run,
	parseConfig,
	runOutput,
	makePithos,
	testClock,
	makeSpawner,
	upsertPandora,
	runSpawnTick,
	runTick,
	fakeTmux,
	fakeProcess,
	fakeFs,
} from "./support.js";

describe("pdx no-claim timeout and session reaping", () => {
	it("no-claim timeout kills, confirms gone, times out, then removes entry and pidfile", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const config = await parseConfig(dataDir);
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		await run(
			registry.upsert({
				runId: "run_timeout",
				agent: "war",
				scopeId: "scope_repo",
				mode: "afk",
				state: "live",
				logicalName: "pdx--war",
				launchedAt: "2026-05-09T00:00:00.000Z",
				everClaimed: false,
				pid: 456,
			}),
		);
		const calls: string[] = [];
		const removes: string[] = [];
		const process = fakeProcess({
			isAlive: () => Effect.sync(() => !calls.includes("kill:456:SIGTERM")),
			kill: (pid, signal) => Effect.sync(() => calls.push(`kill:${pid}:${signal}`)),
		});
		await runTick({
			config,
			registry,
			pithos: makePithos(calls, [], {
				runTimeout: (input) =>
					Effect.sync(() => calls.push(`runTimeout:${input.runId}:${input.reason}`)),
			}),
			ids: Ids.of({ nextRunId: Effect.succeed("r"), nextSessionId: Effect.succeed("s") }),
			process,
			fs: fakeFs({ removeFile: (path) => Effect.sync(() => removes.push(path)) }),
		});
		expect(calls.filter((call) => !call.startsWith("taskHeartbeat:"))).toEqual([
			"kill:456:SIGTERM",
			"runTimeout:run_timeout:no_claim_timeout",
			"pruneEvents",
		]);
		expect(removes).toContain(`${config.runsDir}/run_timeout.pid`);
		expect(await run(registry.list)).toEqual([expect.objectContaining({ runId: "run_pandora" })]);
	});

	it("no-claim timeout excludes Pandora and previously claimed idle runs", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		await run(
			registry.upsert({
				runId: "run_idle",
				agent: "war",
				scopeId: "scope_repo",
				mode: "afk",
				state: "live",
				logicalName: "pdx--war",
				launchedAt: "2026-05-09T00:00:00.000Z",
				everClaimed: true,
				pid: 456,
			}),
		);
		const calls: string[] = [];
		await runSpawnTick({
			dataDir,
			registry,
			pithos: makePithos(calls),
			launches: [],
		});
		expect(calls).not.toContain("runTimeout:run_idle:no_claim_timeout");
		expect(await run(registry.list)).toHaveLength(2);
	});

	it("no-claim timeout preserves entry when Pithos rejects a held task", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		await run(
			registry.upsert({
				runId: "run_held",
				agent: "war",
				scopeId: "scope_repo",
				mode: "afk",
				state: "live",
				logicalName: "pdx--war",
				launchedAt: "2026-05-09T00:00:00.000Z",
				everClaimed: false,
				pid: 456,
			}),
		);
		const calls: string[] = [];
		const process = fakeProcess({
			isAlive: () => Effect.sync(() => !calls.includes("kill:456:SIGTERM")),
			kill: (pid, signal) => Effect.sync(() => calls.push(`kill:${pid}:${signal}`)),
		});
		const config = await parseConfig(dataDir);
		await expect(
			runTick({
				config,
				registry,
				pithos: makePithos(calls, [], {
					runTimeout: () =>
						Effect.fail(new PdxError({ code: "VALIDATION_ERROR", message: "held task" })),
				}),
				ids: Ids.of({ nextRunId: Effect.succeed("r"), nextSessionId: Effect.succeed("s") }),
				process,
			}),
		).rejects.toThrow("held task");
		expect(calls.filter((call) => !call.startsWith("taskHeartbeat:"))).toEqual([
			"kill:456:SIGTERM",
		]);
		expect(await run(registry.list)).toEqual(
			expect.arrayContaining([expect.objectContaining({ runId: "run_held", state: "live" })]),
		);
	});

	it("reaps completed non-Pandora HITL runs after their task clears", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		await run(
			registry.upsert({
				runId: "run_greed",
				agent: "greed",
				scopeId: "scope_repo",
				mode: "hitl",
				state: "live",
				logicalName: "pdx--greed",
				tmuxTarget: "pdx--greed",
				everClaimed: true,
			}),
		);
		const calls: string[] = [];
		const killed: string[] = [];
		const tmux = fakeTmux({
			hasSession: (target) => Effect.succeed(target === PANDORA_TARGET || !killed.includes(target)),
			killSession: (target) => Effect.sync(() => killed.push(target)),
		});
		const config = await parseConfig(dataDir);
		await runTick({
			config,
			registry,
			pithos: makePithos(calls, [], {
				runInspect: (input) =>
					Effect.succeed(
						runOutput({
							id: input.runId,
							agent: "greed",
							mode: "hitl",
							scope_id: "scope_repo",
							task_id: null,
						}),
					),
			}),
			ids: Ids.of({ nextRunId: Effect.succeed("r"), nextSessionId: Effect.succeed("s") }),
			tmux,
		});
		expect(killed).toEqual(["pdx--greed"]);
		expect(calls.filter((call) => !call.startsWith("taskHeartbeat:"))).toContain(
			"runCleanup:run_greed:task_cleared",
		);
		expect(await run(registry.list)).toEqual([expect.objectContaining({ runId: "run_pandora" })]);
	});

	it("keeps Pandora HITL session alive after its task clears", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const calls: string[] = [];
		await runSpawnTick({
			dataDir,
			registry,
			pithos: makePithos(calls, [], {
				runInspect: (input) =>
					Effect.succeed(
						runOutput({
							id: input.runId,
							agent: "pandora",
							mode: "hitl",
							scope_id: "global",
							task_id: null,
						}),
					),
			}),
			launches: [],
		});
		expect(calls).toContain("taskHeartbeat:run_pandora");
		expect(calls).not.toContain("runCleanup:run_pandora:task_cleared");
		expect(await run(registry.list)).toEqual([expect.objectContaining({ runId: "run_pandora" })]);
	});

	it("preserves completed non-Pandora HITL entry when cleanup fails", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		await run(
			registry.upsert({
				runId: "run_greed",
				agent: "greed",
				scopeId: "scope_repo",
				mode: "hitl",
				state: "live",
				logicalName: "pdx--greed",
				tmuxTarget: "pdx--greed",
				everClaimed: true,
			}),
		);
		const killed: string[] = [];
		const tmux = fakeTmux({
			hasSession: (target) => Effect.succeed(target === PANDORA_TARGET || !killed.includes(target)),
			killSession: (target) => Effect.sync(() => killed.push(target)),
		});
		const config = await parseConfig(dataDir);
		await expect(
			runTick({
				config,
				registry,
				pithos: makePithos([], [], {
					runInspect: (input) =>
						Effect.succeed(
							runOutput({
								id: input.runId,
								agent: "greed",
								mode: "hitl",
								scope_id: "scope_repo",
								task_id: null,
							}),
						),
					runCleanup: () =>
						Effect.fail(new PdxError({ code: "PROCESS_ERROR", message: "cleanup failed" })),
				}),
				ids: Ids.of({ nextRunId: Effect.succeed("r"), nextSessionId: Effect.succeed("s") }),
				tmux,
			}),
		).rejects.toThrow("cleanup failed");
		expect(killed).toEqual(["pdx--greed"]);
		expect(await run(registry.list)).toEqual(
			expect.arrayContaining([expect.objectContaining({ runId: "run_greed", state: "live" })]),
		);
	});

	it("HITL launch writes no pidfile", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const writes: string[] = [];
		const pithos = makePithos(
			[],
			[
				{
					scope_id: "scope_greed",
					capability: "design",
					scope_kind: "worktree",
					canonical_path: "/wt",
				},
			],
		);
		const config = await parseConfig(dataDir);
		await runTick({
			config,
			registry,
			pithos,
			ids: Ids.of({ nextRunId: Effect.succeed("run_greed"), nextSessionId: Effect.succeed("s") }),
			spawner: makeSpawner({
				launchAgent: (input) =>
					Effect.succeed({
						...input,
						logicalName: "pdx--greed",
						hitl: { tmuxTarget: "pdx--greed", panePid: 1 },
					}),
			}),
			fs: fakeFs({ writeFileAtomic: (path) => Effect.sync(() => writes.push(path)) }),
		});
		expect(writes).toEqual([]);
	});

	it("does not remove AFK pidfile when cleanup fails after process exit", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
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
		const removes: string[] = [];
		const config = await parseConfig(dataDir);
		await expect(
			runTick({
				config,
				registry,
				pithos: makePithos([], [], {
					runCleanup: () =>
						Effect.fail(new PdxError({ code: "PROCESS_ERROR", message: "cleanup failed" })),
				}),
				ids: Ids.of({ nextRunId: Effect.succeed("r"), nextSessionId: Effect.succeed("s") }),
				process: fakeProcess({ isAlive: () => Effect.succeed(false) }),
				fs: fakeFs({ removeFile: (path) => Effect.sync(() => removes.push(path)) }),
			}),
		).rejects.toThrow("cleanup failed");
		expect(removes).toEqual([]);
	});

	it("AFK pidfile write failure rolls back launch before surfacing the error", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const pithosCalls: string[] = [];
		const kills: string[] = [];
		const fs = fakeFs({
			writeFileAtomic: () =>
				Effect.fail(new PdxError({ code: "FS_ERROR", message: "pidfile write failed" })),
		});
		const process = fakeProcess({
			isAlive: (pid) => Effect.succeed(!kills.includes(`${pid}:SIGTERM`)),
			kill: (pid, signal) => Effect.sync(() => kills.push(`${pid}:${signal}`)),
		});
		const config = await parseConfig(dataDir);
		await expect(
			runTick({
				config,
				registry,
				pithos: makePithos(pithosCalls, [
					{
						scope_id: "scope_repo",
						capability: "execute",
						scope_kind: "repo",
						canonical_path: "/repo",
					},
				]),
				ids: Ids.of({
					nextRunId: Effect.succeed("run_war"),
					nextSessionId: Effect.succeed("session_war"),
				}),
				spawner: makeSpawner({
					launchAgent: (input) =>
						Effect.succeed({
							...input,
							logicalName: "pdx--war",
							afk: { pid: 456, processStartTime: "now" },
						}),
				}),
				process,
				fs,
			}),
		).rejects.toThrow("pidfile write failed");
		expect(kills).toEqual(["456:SIGTERM"]);
		expect(pithosCalls).toContain("runCleanup:run_war:launch_failed");
		expect(await run(registry.list)).toEqual([expect.objectContaining({ runId: "run_pandora" })]);
	});

	it("live filesystem atomic write leaves final file and removes tmp path", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const path = join(dir, "run.pid");
		await run(
			FileSystemLive.writeFileAtomic(path, "456\n").pipe(
				Effect.provideService(FileSystem, FileSystemLive),
				Effect.provideService(Clock, testClock),
			),
		);
		await expect(readFile(path, "utf8")).resolves.toBe("456\n");
		expect(existsSync(`${path}.tmp`)).toBe(false);
	});
});
