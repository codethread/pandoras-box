import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { makeSupervisorLog } from "../src/log.js";
import { Clock, FileSystem, Process } from "../src/services.js";
import { formatLifecycleEvent } from "../src/lifecycle.js";
import { makeTmux } from "../src/tmux.js";
import { PANDORA_TARGET } from "../src/controller.js";
import { run, stripAnsi, fakeProcess, fakeFs } from "./support.js";

describe("pdx tmux and logging primitives", () => {
	it("constructs tmux argv and sends literal line as text then enter", async () => {
		const calls: { file: string; args: readonly string[]; cwd: string | undefined }[] = [];
		const process = fakeProcess({
			execFile: (file, args, options) =>
				Effect.sync(() => {
					calls.push({ file, args, cwd: options?.cwd });
					return { exitCode: 0, stdout: "", stderr: "" };
				}),
		});
		const tmux = await run(makeTmux.pipe(Effect.provideService(Process, process)));
		await run(tmux.sendLiteralLine("pdx--pandora", "hello; rm -rf /"));
		expect(calls).toEqual([
			{
				file: "tmux",
				args: ["send-keys", "-t", "pdx--pandora", "-l", "--", "hello; rm -rf /"],
				cwd: undefined,
			},
			{ file: "tmux", args: ["send-keys", "-t", "pdx--pandora", "Enter"], cwd: undefined },
		]);
	});

	it("attaches to tmux through the foreground process path", async () => {
		const calls: { file: string; args: readonly string[] }[] = [];
		const process = fakeProcess({
			foreground: (file, args) =>
				Effect.sync(() => {
					calls.push({ file, args });
					return { exitCode: 0, stdout: "", stderr: "" };
				}),
		});
		const tmux = await run(makeTmux.pipe(Effect.provideService(Process, process)));
		await run(tmux.attachSession(PANDORA_TARGET));
		expect(calls).toEqual([{ file: "tmux", args: ["attach", "-t", PANDORA_TARGET] }]);
	});

	it("switches the current tmux client without foreground attach", async () => {
		const calls: { file: string; args: readonly string[] }[] = [];
		const process = fakeProcess({
			execFile: (file, args) =>
				Effect.sync(() => {
					calls.push({ file, args });
					return { exitCode: 0, stdout: "", stderr: "" };
				}),
			foreground: () => Effect.die("unexpected attach"),
		});
		const tmux = await run(makeTmux.pipe(Effect.provideService(Process, process)));
		await run(tmux.switchClient(PANDORA_TARGET));
		expect(calls).toEqual([{ file: "tmux", args: ["switch-client", "-t", PANDORA_TARGET] }]);
	});

	it("writes supervisor logs with required fields", async () => {
		const writes: string[] = [];
		const fs = fakeFs({
			appendFile: (_path, content) => Effect.sync(() => writes.push(content)),
		});
		const clock = Clock.of({ nowIso: Effect.succeed("2026-05-09T00:00:00.000Z") });
		const log = await run(
			makeSupervisorLog("/tmp/pdx.jsonl").pipe(
				Effect.provideService(FileSystem, fs),
				Effect.provideService(Clock, clock),
			),
		);
		await run(log.write({ level: "info", span: "test-span", msg: "hello" }));
		expect(JSON.parse(writes[0] ?? "{}")).toEqual({
			ts: "2026-05-09T00:00:00.000Z",
			level: "info",
			span: "test-span",
			msg: "hello",
		});
	});

	it("formats lifecycle pulse lines for spawn, remove, nudge, and errors", () => {
		const now = new Date("2026-05-09T00:31:00.000Z");
		expect(
			stripAnsi(
				formatLifecycleEvent(now, {
					kind: "spawned",
					agent: "war",
					mode: "afk",
					runId: "run_war",
					scopeId: "repo:/tmp/repo",
					sessionId: "session_war",
					pid: 321,
				}),
			),
		).toBe("[May 9 00:31] spawn war afk run=run_war scope=repo:/tmp/repo session=session_war");
		expect(
			stripAnsi(
				formatLifecycleEvent(now, {
					kind: "removed",
					agent: "greed",
					runId: "run_greed",
					scopeId: "global",
					reason: "terminated",
					tmuxTarget: PANDORA_TARGET,
				}),
			),
		).toBe("[May 9 00:31] remove greed terminated run=run_greed scope=global");
		expect(
			stripAnsi(
				formatLifecycleEvent(now, {
					kind: "nudge",
					reason: "claimable_escalate",
					target: PANDORA_TARGET,
					claimableEscalateCount: 2,
				}),
			),
		).toBe(
			"[May 9 00:31] nudge pandora claimable-escalate target=pdx--pandora claimable-escalate=2",
		);
		expect(
			stripAnsi(
				formatLifecycleEvent(now, {
					kind: "nudge",
					reason: "task_failed_alert",
					target: PANDORA_TARGET,
					claimableEscalateCount: 1,
				}),
			),
		).toBe("[May 9 00:31] nudge pandora task-failed target=pdx--pandora claimable-escalate=1");
		expect(
			stripAnsi(
				formatLifecycleEvent(now, {
					kind: "nudge",
					reason: "task_dead_lettered_alert",
					target: PANDORA_TARGET,
					claimableEscalateCount: 1,
				}),
			),
		).toBe(
			"[May 9 00:31] nudge pandora task-dead-lettered target=pdx--pandora claimable-escalate=1",
		);
		expect(
			stripAnsi(
				formatLifecycleEvent(now, {
					kind: "error",
					span: "pdx.reconcile",
					message: "tmux exploded",
					attempt: 2,
					maxAttempts: 3,
				}),
			),
		).toBe("[May 9 00:31] error pdx.reconcile attempt=2/3 tmux exploded");
	});
});
