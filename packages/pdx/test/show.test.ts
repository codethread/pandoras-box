import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { listenIpc } from "../src/ipc-socket.js";
import { PithosClient, Tmux } from "../src/services.js";
import { makeEngine } from "@pdx/pithos";
import { DAEMON_TARGET, runShowPdx, taskShowPdx } from "../src/controller.js";
import {
	runPdxCli,
	makeFakeTmux,
	run,
	parseConfig,
	runOutput,
	makePithos,
	alwaysLiveTmux,
	pithosTestServices,
	fakeTmux,
} from "./support.js";

describe("pdx run show and task show", () => {
	it("run show switches tmux client to the supervised run target and returns confirmation", async () => {
		const switches: string[] = [];
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-show-run-"));
		const config = await parseConfig(dataDir);
		const server = await run(
			listenIpc(config.socketPath, () =>
				Effect.succeed({
					ok: true,
					data: {
						daemon: "running",
						max_afk: 4,
						registry_entries: [
							{
								runId: "run_hitl",
								agent: "greed",
								scopeId: "scope_repo",
								mode: "hitl",
								state: "live",
								logicalName: "pdx--greed",
								tmuxTarget: "pdx--greed",
							},
						],
					},
				}),
			),
		);
		try {
			const confirmation = await run(
				runShowPdx(config, { runId: "run_hitl" }).pipe(
					Effect.provideService(
						Tmux,
						fakeTmux({
							hasSession: (target) => Effect.succeed(target === DAEMON_TARGET),
							switchClient: (target) => Effect.sync(() => switches.push(target)),
						}),
					),
				),
			);
			expect(confirmation).toEqual({
				ok: true,
				action: "tmux_attached",
				target: "pdx--greed",
				run_id: "run_hitl",
			});
		} finally {
			await run(server.close);
		}
		expect(switches).toEqual(["pdx--greed"]);
	});

	it("run show reports AFK runs as intentionally headless", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-show-afk-run-"));
		const config = await parseConfig(dataDir);
		const server = await run(
			listenIpc(config.socketPath, () =>
				Effect.succeed({
					ok: true,
					data: {
						daemon: "running",
						max_afk: 4,
						registry_entries: [
							{
								runId: "run_afk",
								agent: "toil",
								scopeId: "scope_repo",
								mode: "afk",
								state: "live",
								logicalName: "pdx--toil",
								pid: 123,
							},
						],
					},
				}),
			),
		);
		try {
			await expect(
				run(
					runShowPdx(config, { runId: "run_afk" }).pipe(
						Effect.provideService(Tmux, alwaysLiveTmux),
					),
				),
			).rejects.toThrow(
				"Run run_afk is afk; no interactive session to show. AFK/headless runs intentionally have no interactive session. Use 'pdx run transcript run_afk' for harness output or 'pdx daemon status' for liveness.",
			);
		} finally {
			await run(server.close);
		}
	});

	it("task show returns confirmation for the holder run target", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-show-task-live-"));
		const config = await parseConfig(dataDir);
		const pithos = makePithos([], [], {
			activeRunForTask: () =>
				Effect.succeed(
					runOutput({
						id: "run_hitl",
						agent: "greed",
						mode: "hitl",
						scope_id: "scope_repo",
						task_id: "task_live",
						session_id: "session_hitl",
					}),
				),
		});
		const server = await run(
			listenIpc(config.socketPath, () =>
				Effect.succeed({
					ok: true,
					data: {
						daemon: "running",
						max_afk: 4,
						registry_entries: [
							{
								runId: "run_hitl",
								agent: "greed",
								scopeId: "scope_repo",
								mode: "hitl",
								state: "live",
								logicalName: "pdx--greed",
								tmuxTarget: "pdx--greed",
							},
						],
					},
				}),
			),
		);
		try {
			await expect(
				run(
					taskShowPdx(config, { taskId: "task_live" }).pipe(
						Effect.provideService(PithosClient, pithos),
						Effect.provideService(Tmux, alwaysLiveTmux),
					),
				),
			).resolves.toEqual({
				ok: true,
				action: "tmux_attached",
				target: "pdx--greed",
				run_id: "run_hitl",
				task_id: "task_live",
			});
		} finally {
			await run(server.close);
		}
	});

	it("task show reports queued tasks without a live run", async () => {
		const config = await parseConfig("/tmp/pdx-show-task");
		const pithos = makePithos([], [], {
			activeRunForTask: () => Effect.succeed(null),
			taskInspect: (input) =>
				Effect.succeed({
					task: {
						id: input.taskId,
						status: "queued",
						scope_id: "scope_repo",
						capability: "execute",
						canonical_path: "/repo",
					},
				}),
		});
		await expect(
			run(
				taskShowPdx(config, { taskId: "task_queued" }).pipe(
					Effect.provideService(PithosClient, pithos),
					Effect.provideService(Tmux, alwaysLiveTmux),
				),
			),
		).rejects.toThrow(/Task task_queued is queued; no live run to show/);
	});

	it("CLI task show prints JSON confirmation for a live holder session", async () => {
		const fakeTmux = await makeFakeTmux();
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-task-show-cli-"));
		const config = await parseConfig(dataDir);
		const engine = makeEngine({
			config: { dbPath: config.pithosDbPath, runId: undefined },
			services: pithosTestServices(),
		});
		engine.init({ fresh: true });
		const repo = engine.scopeUpsert({ kind: "repo", path: dataDir }).scope.id;
		engine.runUpsert({
			agent: "greed",
			mode: "hitl",
			scope: repo,
			cwd: dataDir,
			sessionId: "greed-session",
			harnessKind: "pi",
			sessionLogPath: join(dataDir, "greed.jsonl"),
			runId: "run_hitl",
		});
		const enqueued = engine.enqueue({
			scope: repo,
			capability: "design",
			title: "design",
			body: "design the change",
			bodyFile: undefined,
			runId: "run_hitl",
			after: [],
			chain: "auto",
		});
		engine.claim({ runId: "run_hitl", scope: repo, capability: "design" });
		const server = await run(
			listenIpc(config.socketPath, () =>
				Effect.succeed({
					ok: true,
					data: {
						daemon: "running",
						max_afk: 4,
						registry_entries: [
							{
								runId: "run_hitl",
								agent: "greed",
								scopeId: repo,
								mode: "hitl",
								state: "live",
								logicalName: "pdx--greed",
								tmuxTarget: "pdx--greed",
							},
						],
					},
				}),
			),
		);
		try {
			const { stdout, stderr } = await runPdxCli(
				["task", "show", enqueued.task.id, "--data-dir", dataDir],
				fakeTmux.env({ PDX_TEST_TMUX_MODE: "daemon-up" }),
			);
			expect(stderr).toBe("");
			expect(JSON.parse(stdout)).toEqual({
				ok: true,
				action: "tmux_attached",
				target: "pdx--greed",
				run_id: "run_hitl",
				task_id: enqueued.task.id,
			});
			expect(await readFile(join(fakeTmux.binDir, "tmux.log"), "utf8")).toBe(
				"switch-client:pdx--greed\n",
			);
		} finally {
			await run(server.close);
		}
	});

	it("CLI run show prints tagged JSON errors when no live tmux session exists", async () => {
		const fakeTmux = await makeFakeTmux();
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-run-show-cli-"));
		await expect(
			runPdxCli(["run", "show", "run_missing", "--data-dir", dataDir], fakeTmux.env()),
		).rejects.toMatchObject({
			code: 2,
			stdout: "",
			stderr: `${JSON.stringify({
				ok: false,
				error: {
					code: "NOT_FOUND",
					message: "Run run_missing is not supervised by pdx or has no live tmux session.",
				},
			})}\n`,
		});
	});
});
