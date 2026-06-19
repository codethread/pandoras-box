import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { PdxError } from "../src/errors.js";
import { defaultSupervisorLaunchPolicy } from "../src/config.js";
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
} from "../src/services.js";
import { PANDORA_TARGET, reconcileTick } from "../src/controller.js";
import {
	run,
	parseConfig,
	makePithos,
	testLog,
	testLifecycle,
	testClock,
	noopFs,
	makeSpawner,
	upsertPandora,
	runSpawnTick,
	fakeTmux,
	fakeProcess,
	fakeFs,
	fakeRepoLaunchChecks,
	runTick,
} from "./support.js";

describe("pdx reconcile spawning and capacity", () => {
	it("reconcile spawns one non-Pandora agent in seeded order without pre-claiming", async () => {
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
		const pithosCalls: string[] = [];
		const pithos = makePithos(pithosCalls, [
			{ scope_id: "scope_war", capability: "execute", scope_kind: "repo", canonical_path: "/repo" },
			{
				scope_id: "scope_greed",
				capability: "design",
				scope_kind: "worktree",
				canonical_path: "/wt",
			},
			{ scope_id: "global", capability: "triage", scope_kind: "global", canonical_path: null },
		]);
		const ids = Ids.of({
			nextRunId: Effect.succeed("run_toil"),
			nextSessionId: Effect.succeed("session_toil"),
		});
		const launches: unknown[] = [];
		const spawner = makeSpawner({
			launchAgent: (input) =>
				Effect.sync(() => {
					launches.push(input);
					return { ...input, logicalName: "pdx--toil", afk: { pid: 123, processStartTime: "now" } };
				}),
		});
		const log = SupervisorLog.of({ write: (record) => Effect.succeed({ ts: "now", ...record }) });
		const tmux = fakeTmux();
		await run(
			reconcileTick(await parseConfig(dataDir)).pipe(
				Effect.provideService(Registry, registry),
				Effect.provideService(PithosClient, pithos),
				Effect.provideService(Ids, ids),
				Effect.provideService(Spawner, spawner),
				Effect.provideService(Tmux, tmux),
				Effect.provideService(RepoLaunchChecks, fakeRepoLaunchChecks()),
				Effect.provideService(SupervisorLog, log),
				Effect.provideService(LifecycleReporter, testLifecycle),
				Effect.provideService(FileSystem, noopFs),
				Effect.provideService(Clock, testClock),
			),
		);
		expect(pithosCalls).toContain("runUpsert:toil:run_toil");
		expect(
			pithosCalls.some(
				(call) => call.startsWith("runInterrupt") || call.startsWith("taskHeartbeat:run_toil"),
			),
		).toBe(false);
		expect(launches).toEqual([
			expect.objectContaining({
				agent: "toil",
				mode: "afk",
				runId: "run_toil",
				sessionId: "session_toil",
				scopeId: "global",
				cwd: dataDir,
			}),
		]);
		expect(await run(registry.list)).toContainEqual(
			expect.objectContaining({ runId: "run_toil", agent: "toil", state: "live", pid: 123 }),
		);
	});

	it("reconcile spawns envy before toil when both intake and triage tasks are ready", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const pithosCalls: string[] = [];
		// Both an intake task (global) and triage tasks are ready.
		const pithos = makePithos(pithosCalls, [
			{ scope_id: "global", capability: "intake", scope_kind: "global", canonical_path: null },
			{ scope_id: "global", capability: "triage", scope_kind: "global", canonical_path: null },
		]);
		const launches: unknown[] = [];
		await runSpawnTick({
			dataDir,
			registry,
			pithos,
			launches,
			runId: "run_envy",
			sessionId: "session_envy",
		});
		// Envy must be launched first, not toil.
		expect(pithosCalls).toContain("runUpsert:envy:run_envy");
		expect(pithosCalls).not.toContain("runUpsert:toil:run_envy");
		expect(launches).toEqual([
			expect.objectContaining({
				agent: "envy",
				mode: "afk",
				scopeId: "global",
				selectedCapability: "intake",
			}),
		]);
	});

	it("reconcile launches clarify work through Envy with selected capability", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const pithosCalls: string[] = [];
		const pithos = makePithos(pithosCalls, [
			{ scope_id: "global", capability: "clarify", scope_kind: "global", canonical_path: null },
		]);
		const launches: unknown[] = [];
		await runSpawnTick({
			dataDir,
			registry,
			pithos,
			launches,
			runId: "run_envy",
			sessionId: "session_envy",
		});
		expect(pithosCalls).toContain("runUpsert:envy:run_envy");
		expect(launches).toEqual([
			expect.objectContaining({
				agent: "envy",
				mode: "afk",
				scopeId: "global",
				selectedCapability: "clarify",
			}),
		]);
	});

	it("missing repo cwd before run creation repairs launch precondition without spawning", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const calls: string[] = [];
		const launches: unknown[] = [];
		await runSpawnTick({
			dataDir,
			registry,
			pithos: makePithos(calls, [
				{
					id: "task_execute",
					scope_id: "scope_repo",
					capability: "execute",
					scope_kind: "repo",
					canonical_path: "/missing-repo",
				},
			]),
			launches,
			fs: { ...noopFs, existsDirectory: () => Effect.succeed(false) },
		});
		expect(launches).toEqual([]);
		expect(calls).not.toContain("runUpsert:war:run_war");
		expect(calls).toContain("escalateLaunchPrecondition:task_execute:scope_repo:/missing-repo");
		expect(await run(registry.list)).toEqual([expect.objectContaining({ runId: "run_pandora" })]);
	});

	it.each([
		{
			name: "non-Git path",
			probe: { _tag: "NotGitWorkTree" as const, path: "/repo" },
			reason: "not_git_repository",
			evidence: ["Reason: not_git_repository", "Scope path: /repo"],
		},
		{
			name: "unknown default branch",
			probe: {
				_tag: "UnknownDefaultBranch" as const,
				path: "/repo",
				gitRoot: "/repo",
				currentBranch: "main",
			},
			reason: "unknown_remote_default_branch",
			evidence: [
				"Reason: unknown_remote_default_branch",
				"Git root: /repo",
				"Current branch: main",
			],
		},
		{
			name: "detached HEAD",
			probe: { _tag: "DetachedHead" as const, path: "/repo", gitRoot: "/repo" },
			reason: "detached_head",
			evidence: ["Reason: detached_head", "Git root: /repo"],
		},
		{
			name: "branch mismatch",
			probe: {
				_tag: "NonDefaultBranch" as const,
				path: "/repo",
				gitRoot: "/repo",
				currentBranch: "feature",
				defaultBranch: "main",
			},
			reason: "branch_mismatch",
			evidence: [
				"Reason: branch_mismatch",
				"Git root: /repo",
				"Current branch: feature",
				"Expected default branch: main",
			],
		},
	])(
		"repo trunk guard repairs launch precondition without rendering or spawning for $name",
		async ({ probe, reason, evidence }) => {
			const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
			const registry = await run(makeRegistry);
			await run(upsertPandora(registry));
			const calls: string[] = [];
			const bodies: string[] = [];
			const launches: unknown[] = [];
			const probePaths: string[] = [];
			let renderCalls = 0;
			await runTick({
				config: await parseConfig(dataDir),
				registry,
				pithos: makePithos(
					calls,
					[
						{
							id: "task_execute",
							scope_id: "scope_repo",
							capability: "execute",
							scope_kind: "repo",
							canonical_path: "/repo",
						},
					],
					{
						escalateLaunchPrecondition: (input) =>
							Effect.sync(() => {
								calls.push(
									`escalateLaunchPrecondition:${input.expectedTaskId}:${input.expectedScopeId}:${input.canonicalPath}:${input.reason}`,
								);
								bodies.push(input.escalationBody);
							}),
					},
				),
				spawner: Spawner.of({
					materializeTemplates: () => Effect.void,
					renderAgent: () =>
						Effect.sync(() => {
							renderCalls += 1;
							throw new PdxError({ code: "PROCESS_ERROR", message: "unexpected render" });
						}),
					launchRenderedAgent: () =>
						Effect.sync(() => {
							launches.push("unexpected");
							throw new PdxError({ code: "PROCESS_ERROR", message: "unexpected launch" });
						}),
					renderSessionTranscript: () => Effect.succeed(""),
				}),
				repoLaunchChecks: fakeRepoLaunchChecks({
					probeDefaultBranch: (path) =>
						Effect.sync(() => {
							probePaths.push(path);
							return probe;
						}),
				}),
			});
			expect(probePaths).toEqual(["/repo"]);
			expect(renderCalls).toBe(0);
			expect(launches).toEqual([]);
			expect(calls).toContain(`escalateLaunchPrecondition:task_execute:scope_repo:/repo:${reason}`);
			expect(calls).not.toContain("runUpsert:war:run_war");
			expect(bodies).toHaveLength(1);
			expect(bodies[0]).toContain("Task Replay is the preferred repair");
			for (const expected of evidence) expect(bodies[0]).toContain(expected);
		},
	);

	it("rechecks the repo trunk guard after render before creating a run", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const calls: string[] = [];
		const bodies: string[] = [];
		let renderCalls = 0;
		let launchCalls = 0;
		const probeResults = [
			{
				_tag: "OnDefaultBranch" as const,
				path: "/repo",
				gitRoot: "/repo",
				currentBranch: "main",
				defaultBranch: "main",
			},
			{
				_tag: "NonDefaultBranch" as const,
				path: "/repo",
				gitRoot: "/repo",
				currentBranch: "feature",
				defaultBranch: "main",
			},
		];
		await runTick({
			config: await parseConfig(dataDir),
			registry,
			pithos: makePithos(
				calls,
				[
					{
						id: "task_execute",
						scope_id: "scope_repo",
						capability: "execute",
						scope_kind: "repo",
						canonical_path: "/repo",
					},
				],
				{
					escalateLaunchPrecondition: (input) =>
						Effect.sync(() => {
							calls.push(
								`escalateLaunchPrecondition:${input.expectedTaskId}:${input.expectedScopeId}:${input.canonicalPath}:${input.reason}`,
							);
							bodies.push(input.escalationBody);
						}),
				},
			),
			spawner: Spawner.of({
				materializeTemplates: () => Effect.void,
				renderAgent: (launch) =>
					Effect.sync(() => {
						renderCalls += 1;
						return {
							...launch,
							logicalName: "pdx--war",
							harness: { kind: "pi" as const, argv: ["pi", launch.runId], env: {} },
							sessionLogPath: `/tmp/${launch.runId}.jsonl`,
							prompt: "test prompt",
						};
					}),
				launchRenderedAgent: () =>
					Effect.sync(() => {
						launchCalls += 1;
						throw new PdxError({ code: "PROCESS_ERROR", message: "unexpected launch" });
					}),
				renderSessionTranscript: () => Effect.succeed(""),
			}),
			repoLaunchChecks: fakeRepoLaunchChecks({
				probeDefaultBranch: () =>
					Effect.sync(() => {
						const result = probeResults.shift();
						if (result === undefined) throw new Error("unexpected extra probe");
						return result;
					}),
			}),
		});
		expect(renderCalls).toBe(1);
		expect(launchCalls).toBe(0);
		expect(probeResults).toEqual([]);
		expect(calls).toContain(
			"escalateLaunchPrecondition:task_execute:scope_repo:/repo:branch_mismatch",
		);
		expect(calls).not.toContain("runUpsert:war:run_war");
		expect(bodies[0]).toContain("Current branch: feature");
		expect(bodies[0]).toContain("Task Replay is the preferred repair");
	});

	it("does not re-probe a stale repo task after render and continues to later agents", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const calls: string[] = [];
		const launches: unknown[] = [];
		let renderCalls = 0;
		const probePaths: string[] = [];
		await runTick({
			config: await parseConfig(dataDir),
			registry,
			pithos: makePithos(
				calls,
				[
					{
						id: "task_design",
						scope_id: "scope_design_repo",
						capability: "design",
						scope_kind: "repo",
						canonical_path: "/design-repo",
					},
					{
						id: "task_execute",
						scope_id: "scope_execute_repo",
						capability: "execute",
						scope_kind: "repo",
						canonical_path: "/execute-repo",
					},
				],
				{
					taskInspect: (input) =>
						Effect.succeed({
							task:
								input.taskId === "task_design"
									? {
											id: input.taskId,
											status: "cancelled",
											scope_id: "scope_design_repo",
											capability: "design",
											canonical_path: "/design-repo",
										}
									: {
											id: input.taskId,
											status: "queued",
											scope_id: "scope_execute_repo",
											capability: "execute",
											canonical_path: "/execute-repo",
										},
						}),
				},
			),
			spawner: Spawner.of({
				materializeTemplates: () => Effect.void,
				renderAgent: (launch) =>
					Effect.sync(() => {
						renderCalls += 1;
						return {
							...launch,
							logicalName: `pdx--${launch.agent}`,
							harness: { kind: "pi" as const, argv: ["pi", launch.runId], env: {} },
							sessionLogPath: `/tmp/${launch.runId}.jsonl`,
							prompt: "test prompt",
						};
					}),
				launchRenderedAgent: (rendered) =>
					Effect.sync(() => {
						launches.push(rendered);
						return {
							...rendered,
							harnessKind: rendered.harness.kind,
							sessionLogPath: rendered.sessionLogPath,
							afk: { pid: 456, processStartTime: "now" },
						};
					}),
				renderSessionTranscript: () => Effect.succeed(""),
			}),
			repoLaunchChecks: fakeRepoLaunchChecks({
				probeDefaultBranch: (path) =>
					Effect.sync(() => {
						probePaths.push(path);
						return {
							_tag: "OnDefaultBranch" as const,
							path,
							gitRoot: path,
							currentBranch: "main",
							defaultBranch: "main",
						};
					}),
			}),
		});
		expect(renderCalls).toBe(2);
		expect(probePaths).toEqual(["/design-repo", "/execute-repo", "/execute-repo"]);
		expect(calls).toContain("runUpsert:war:run_war");
		expect(calls).not.toContain("runUpsert:greed:run_war");
		expect(launches).toEqual([expect.objectContaining({ agent: "war", cwd: "/execute-repo" })]);
	});

	it("disabled repo trunk guard does not probe repo launches", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const calls: string[] = [];
		const launches: unknown[] = [];
		let probeCalls = 0;
		const disabledPolicy = {
			launch_preconditions: {
				...defaultSupervisorLaunchPolicy.launch_preconditions,
				enforce_repo_root_trunk: false,
			},
		};
		await runTick({
			config: await parseConfig(dataDir),
			registry,
			pithos: makePithos(calls, [
				{
					id: "task_execute",
					scope_id: "scope_repo",
					capability: "execute",
					scope_kind: "repo",
					canonical_path: "/repo",
				},
			]),
			spawner: makeSpawner({
				launchAgent: (launch) =>
					Effect.sync(() => {
						launches.push(launch);
						return {
							...launch,
							logicalName: "pdx--war",
							afk: { pid: 456, processStartTime: "now" },
						};
					}),
			}),
			repoLaunchChecks: fakeRepoLaunchChecks({
				probeDefaultBranch: () =>
					Effect.sync(() => {
						probeCalls += 1;
						return {
							_tag: "NonDefaultBranch" as const,
							path: "/repo",
							gitRoot: "/repo",
							currentBranch: "feature",
							defaultBranch: "main",
						};
					}),
			}),
			tickEffect: (config) => reconcileTick(config, 4, disabledPolicy),
		});
		expect(probeCalls).toBe(0);
		expect(launches).toEqual([expect.objectContaining({ agent: "war", cwd: "/repo" })]);
		expect(calls).toContain("runUpsert:war:run_war");
	});

	it("worktree-scoped ready tasks are exempt from the repo trunk guard", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const launches: unknown[] = [];
		let probeCalls = 0;
		await runSpawnTick({
			dataDir,
			registry,
			pithos: makePithos(
				[],
				[
					{
						id: "task_review",
						scope_id: "scope_worktree",
						capability: "review",
						scope_kind: "worktree",
						canonical_path: "/worktree",
					},
				],
			),
			launches,
			repoLaunchChecks: fakeRepoLaunchChecks({
				probeDefaultBranch: () =>
					Effect.sync(() => {
						probeCalls += 1;
						return {
							_tag: "NonDefaultBranch" as const,
							path: "/worktree",
							gitRoot: "/repo",
							currentBranch: "feature",
							defaultBranch: "main",
						};
					}),
			}),
		});
		expect(probeCalls).toBe(0);
		expect(launches).toEqual([expect.objectContaining({ agent: "greed", cwd: "/worktree" })]);
	});

	it("aborts no-claim run and repairs launch precondition when cwd disappears during launch", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const calls: string[] = [];
		const launches: unknown[] = [];
		let existsChecks = 0;
		await runSpawnTick({
			dataDir,
			registry,
			pithos: makePithos(calls, [
				{
					id: "task_execute",
					scope_id: "scope_repo",
					capability: "execute",
					scope_kind: "repo",
					canonical_path: "/repo-vanished",
				},
			]),
			launches,
			fs: {
				...noopFs,
				existsDirectory: () =>
					Effect.sync(() => {
						existsChecks += 1;
						return existsChecks < 3;
					}),
			},
			launchAgent: (launch) =>
				Effect.sync(() => launches.push(launch)).pipe(
					Effect.zipRight(
						Effect.fail(new PdxError({ code: "LAUNCH_ERROR", message: "cwd vanished" })),
					),
				),
		});
		expect(launches).toEqual([expect.objectContaining({ agent: "war", cwd: "/repo-vanished" })]);
		expect(calls).toEqual(
			expect.arrayContaining([
				"runUpsert:war:run_war",
				"runLaunchAbort:run_war:launch_precondition_failed",
				"escalateLaunchPrecondition:task_execute:scope_repo:/repo-vanished",
			]),
		);
		expect(calls).not.toContain("runCleanup:run_war:launch_failed");
		expect(await run(registry.list)).toEqual([expect.objectContaining({ runId: "run_pandora" })]);
	});

	it.each(["launching", "live", "terminating"] as const)(
		"per-agent/scope cap blocks spawn while existing entry is %s",
		async (state) => {
			const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
			const registry = await run(makeRegistry);
			await run(upsertPandora(registry));
			await run(
				registry.upsert({
					runId: "run_existing",
					agent: "war",
					scopeId: "scope_repo",
					mode: "afk",
					state,
					logicalName: "pdx--war-existing",
					...(state === "live"
						? { launchedAt: "2026-05-09T00:00:31.000Z", everClaimed: false }
						: {}),
					pid: 123,
				}),
			);
			const calls: string[] = [];
			const launches: unknown[] = [];
			await runSpawnTick({
				dataDir,
				registry,
				pithos: makePithos(calls, [
					{
						scope_id: "scope_repo",
						capability: "execute",
						scope_kind: "repo",
						canonical_path: "/repo",
					},
				]),
				launches,
			});
			expect(launches).toEqual([]);
			expect(calls).not.toContain("runUpsert:war:run_war");
		},
	);

	it.each(["launching", "live", "terminating"] as const)(
		"global AFK cap blocks non-Pandora spawns while existing entry is %s",
		async (state) => {
			const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
			const registry = await run(makeRegistry);
			await run(upsertPandora(registry));
			await run(
				registry.upsert({
					runId: "run_toil_existing",
					agent: "toil",
					scopeId: "scope_other",
					mode: "afk",
					state,
					logicalName: "pdx--toil-existing",
					...(state === "live"
						? { launchedAt: "2026-05-09T00:00:31.000Z", everClaimed: false }
						: {}),
					pid: 123,
				}),
			);
			const calls: string[] = [];
			const launches: unknown[] = [];
			await runSpawnTick({
				dataDir,
				registry,
				maxAfk: 1,
				pithos: makePithos(calls, [
					{
						scope_id: "scope_repo",
						capability: "execute",
						scope_kind: "repo",
						canonical_path: "/repo",
					},
				]),
				launches,
			});
			expect(launches).toEqual([]);
			expect(calls).not.toContain("runUpsert:war:run_war");
		},
	);

	it("global AFK cap releases after entry removal", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		await run(
			registry.upsert({
				runId: "run_toil_existing",
				agent: "toil",
				scopeId: "scope_other",
				mode: "afk",
				state: "live",
				logicalName: "pdx--toil-existing",
				pid: 123,
			}),
		);
		await run(registry.remove("run_toil_existing"));
		const launches: unknown[] = [];
		await runSpawnTick({
			dataDir,
			registry,
			maxAfk: 1,
			pithos: makePithos(
				[],
				[
					{
						scope_id: "scope_repo",
						capability: "execute",
						scope_kind: "repo",
						canonical_path: "/repo",
					},
				],
			),
			launches,
		});
		expect(launches).toEqual([expect.objectContaining({ agent: "war", scopeId: "scope_repo" })]);
	});

	it("Pandora does not consume global AFK capacity", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const launches: unknown[] = [];
		await runSpawnTick({
			dataDir,
			registry,
			maxAfk: 1,
			runId: "run_toil",
			sessionId: "session_toil",
			pithos: makePithos(
				[],
				[{ scope_id: "global", capability: "triage", scope_kind: "global", canonical_path: null }],
			),
			launches,
		});
		expect(launches).toEqual([expect.objectContaining({ agent: "toil" })]);
	});

	it("derives non-Pandora cwd from repo and worktree scopes", async () => {
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
		const ids = Ids.of({
			nextRunId: Effect.succeed("run_greed"),
			nextSessionId: Effect.succeed("session_greed"),
		});
		const launches: unknown[] = [];
		const spawner = makeSpawner({
			launchAgent: (input) =>
				Effect.sync(() => {
					launches.push(input);
					return {
						...input,
						logicalName: "pdx--greed",
						hitl: { tmuxTarget: "pdx--greed", panePid: 1 },
					};
				}),
		});
		const log = SupervisorLog.of({ write: (record) => Effect.succeed({ ts: "now", ...record }) });
		const tmux = fakeTmux();
		await run(
			reconcileTick(await parseConfig(dataDir)).pipe(
				Effect.provideService(Registry, registry),
				Effect.provideService(PithosClient, pithos),
				Effect.provideService(Ids, ids),
				Effect.provideService(Spawner, spawner),
				Effect.provideService(Tmux, tmux),
				Effect.provideService(RepoLaunchChecks, fakeRepoLaunchChecks()),
				Effect.provideService(SupervisorLog, log),
				Effect.provideService(LifecycleReporter, testLifecycle),
				Effect.provideService(FileSystem, noopFs),
				Effect.provideService(Clock, testClock),
			),
		);
		expect(launches).toEqual([
			expect.objectContaining({
				agent: "greed",
				cwd: "/wt",
				scopeId: "scope_greed",
				selectedCapability: "design",
			}),
		]);
	});

	it("spawns Greed for review work and passes the selected capability", async () => {
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
		const pithos = makePithos(
			[],
			[
				{
					scope_id: "scope_review",
					capability: "review",
					scope_kind: "repo",
					canonical_path: "/repo",
				},
			],
		);
		const ids = Ids.of({
			nextRunId: Effect.succeed("run_greed_review"),
			nextSessionId: Effect.succeed("session_greed_review"),
		});
		const launches: unknown[] = [];
		const spawner = makeSpawner({
			launchAgent: (input) =>
				Effect.sync(() => {
					launches.push(input);
					return {
						...input,
						logicalName: "pdx--greed",
						hitl: { tmuxTarget: "pdx--greed", panePid: 1 },
					};
				}),
		});
		const log = SupervisorLog.of({ write: (record) => Effect.succeed({ ts: "now", ...record }) });
		const tmux = fakeTmux();
		await run(
			reconcileTick(await parseConfig(dataDir)).pipe(
				Effect.provideService(Registry, registry),
				Effect.provideService(PithosClient, pithos),
				Effect.provideService(Ids, ids),
				Effect.provideService(Spawner, spawner),
				Effect.provideService(Tmux, tmux),
				Effect.provideService(RepoLaunchChecks, fakeRepoLaunchChecks()),
				Effect.provideService(SupervisorLog, log),
				Effect.provideService(LifecycleReporter, testLifecycle),
				Effect.provideService(FileSystem, noopFs),
				Effect.provideService(Clock, testClock),
			),
		);
		expect(launches).toEqual([
			expect.objectContaining({
				agent: "greed",
				mode: "hitl",
				cwd: "/repo",
				scopeId: "scope_review",
				selectedCapability: "review",
			}),
		]);
	});

	it("spawns War for repo execute work with repo cwd", async () => {
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
		const pithos = makePithos(
			[],
			[
				{
					scope_id: "scope_repo",
					capability: "execute",
					scope_kind: "repo",
					canonical_path: "/repo",
				},
			],
		);
		const ids = Ids.of({
			nextRunId: Effect.succeed("run_war"),
			nextSessionId: Effect.succeed("session_war"),
		});
		const launches: unknown[] = [];
		const probePaths: string[] = [];
		const spawner = makeSpawner({
			launchAgent: (input) =>
				Effect.sync(() => {
					launches.push(input);
					return { ...input, logicalName: "pdx--war", afk: { pid: 456, processStartTime: "now" } };
				}),
		});
		const log = SupervisorLog.of({ write: (record) => Effect.succeed({ ts: "now", ...record }) });
		const tmux = fakeTmux();
		await run(
			reconcileTick(await parseConfig(dataDir)).pipe(
				Effect.provideService(Registry, registry),
				Effect.provideService(PithosClient, pithos),
				Effect.provideService(Ids, ids),
				Effect.provideService(Spawner, spawner),
				Effect.provideService(Tmux, tmux),
				Effect.provideService(
					RepoLaunchChecks,
					fakeRepoLaunchChecks({
						probeDefaultBranch: (path) =>
							Effect.sync(() => {
								probePaths.push(path);
								return {
									_tag: "OnDefaultBranch" as const,
									path,
									gitRoot: "/repo",
									currentBranch: "main",
									defaultBranch: "main",
								};
							}),
					}),
				),
				Effect.provideService(SupervisorLog, log),
				Effect.provideService(LifecycleReporter, testLifecycle),
				Effect.provideService(FileSystem, noopFs),
				Effect.provideService(Clock, testClock),
			),
		);
		expect(probePaths).toEqual(["/repo", "/repo"]);
		expect(launches).toEqual([
			expect.objectContaining({
				agent: "war",
				mode: "afk",
				runId: "run_war",
				sessionId: "session_war",
				scopeId: "scope_repo",
				cwd: "/repo",
			}),
		]);
	});

	it("AFK launch writes pidfile and cleanup removes it after Pithos cleanup", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-test-"));
		const registry = await run(makeRegistry);
		await run(upsertPandora(registry));
		const writes: string[] = [];
		const removes: string[] = [];
		const fs = fakeFs({
			writeFileAtomic: (path, content) => Effect.sync(() => writes.push(`${path}:${content}`)),
			removeFile: (path) => Effect.sync(() => removes.push(path)),
		});
		const pithos = makePithos(
			[],
			[
				{
					scope_id: "scope_repo",
					capability: "execute",
					scope_kind: "repo",
					canonical_path: "/repo",
				},
			],
		);
		const ids = Ids.of({
			nextRunId: Effect.succeed("run_war"),
			nextSessionId: Effect.succeed("session_war"),
		});
		const spawner = makeSpawner({
			launchAgent: (input) =>
				Effect.succeed({
					...input,
					logicalName: "pdx--war",
					afk: { pid: 456, processStartTime: "now" },
				}),
		});
		const process = fakeProcess();
		const tmux = fakeTmux();
		const config = await parseConfig(dataDir);
		await run(
			reconcileTick(config).pipe(
				Effect.provideService(Registry, registry),
				Effect.provideService(PithosClient, pithos),
				Effect.provideService(Ids, ids),
				Effect.provideService(Spawner, spawner),
				Effect.provideService(Tmux, tmux),
				Effect.provideService(Process, process),
				Effect.provideService(RepoLaunchChecks, fakeRepoLaunchChecks()),
				Effect.provideService(SupervisorLog, testLog),
				Effect.provideService(LifecycleReporter, testLifecycle),
				Effect.provideService(FileSystem, fs),
				Effect.provideService(Clock, testClock),
			),
		);
		expect(writes).toEqual([`${config.runsDir}/run_war.pid:456\n`]);
		await run(
			reconcileTick(config).pipe(
				Effect.provideService(Registry, registry),
				Effect.provideService(PithosClient, pithos),
				Effect.provideService(Ids, ids),
				Effect.provideService(Spawner, spawner),
				Effect.provideService(Tmux, tmux),
				Effect.provideService(Process, fakeProcess({ isAlive: () => Effect.succeed(false) })),
				Effect.provideService(RepoLaunchChecks, fakeRepoLaunchChecks()),
				Effect.provideService(SupervisorLog, testLog),
				Effect.provideService(LifecycleReporter, testLifecycle),
				Effect.provideService(FileSystem, fs),
				Effect.provideService(Clock, testClock),
			),
		);
		expect(removes).toContain(`${config.runsDir}/run_war.pid`);
	});
});
