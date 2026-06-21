import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { runFagent, type FagentServices } from "../src/index.js";

const services: FagentServices = {
	readText: (path) => readFileSync(path, "utf8"),
	resolvePath: (cwd, path) => resolve(cwd, path),
};

const pithosBin = resolve(process.cwd(), "../pithos/bin/pithos");

const pithos = (dbPath: string, args: readonly string[], input?: string) => {
	const result = spawnSync(pithosBin, [...args], {
		input,
		encoding: "utf8",
		env: { ...process.env, PITHOS_DB: dbPath },
	});
	if (result.status !== 0)
		throw new Error(`pithos ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
	return JSON.parse(result.stdout) as Record<string, unknown>;
};

const jsonl = (path: string) =>
	readFileSync(path, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as Record<string, unknown>);

const runScript = (
	dbPath: string,
	argv: readonly string[],
	cwd: string,
	env: Record<string, string>,
) =>
	runFagent(argv, cwd, {
		...services,
		env: { ...process.env, PITHOS_DB: dbPath, ...env },
		appendText: (path, text) => appendFileSync(path, text),
		execFile: (file, args, input) => {
			const result = spawnSync(file, [...args], {
				input,
				encoding: "utf8",
				env: { ...process.env, PITHOS_DB: dbPath, ...env },
			});
			if (result.status !== 0) throw new Error(result.stderr || result.stdout);
			return result.stdout;
		},
	});

const makeFixture = async (name: string) => {
	const root = await mkdtemp(join(tmpdir(), `fagent-${name}-`));
	const configPath = join(root, "fagent.json");
	await writeFile(configPath, JSON.stringify({ responses: { ping: "pong" } }), "utf8");
	return { root, configPath };
};

describe("fagent", () => {
	beforeAll(() => {
		for (const cwd of [resolve(process.cwd(), "../pithos"), process.cwd()]) {
			const result = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd, encoding: "utf8" });
			if (result.status !== 0)
				throw new Error(`failed to build test bin in ${cwd}: ${result.stderr}`);
		}
	});

	test("emits an exact configured response from Spawner-shaped AFK argv", async () => {
		const { configPath } = await makeFixture("response");

		expect(
			runFagent(
				[
					"--config",
					configPath,
					"--session-id",
					"session-1",
					"--model",
					"fake",
					"--system-prompt",
					"system prompt",
					"--print",
					"ping",
				],
				process.cwd(),
				services,
			),
		).toBe("pong");
	});

	test("reads relative files with deterministic READ_RESULT sections", async () => {
		const { root, configPath } = await makeFixture("read");
		await writeFile(join(root, "alpha.txt"), "alpha\n", "utf8");
		await writeFile(join(root, "nested.txt"), "nested", "utf8");

		expect(
			runFagent(["--config", configPath, "--print", "READ alpha.txt,nested.txt"], root, services),
		).toBe(["READ_RESULT", "FILE alpha.txt", "alpha\n", "FILE nested.txt", "nested"].join("\n"));
	});

	test("fails loudly for required MVP failure modes", async () => {
		const { root, configPath } = await makeFixture("failures");
		const badConfig = join(root, "bad.json");
		await writeFile(badConfig, JSON.stringify({ responses: { ping: 123 } }), "utf8");

		expect(() => runFagent(["--print", "ping"], process.cwd(), services)).toThrow(
			"missing required --config path",
		);
		expect(() =>
			runFagent(["--config", badConfig, "--print", "ping"], process.cwd(), services),
		).toThrow("response for ping must be a string");
		expect(() =>
			runFagent(["--config", configPath, "--print", "unknown"], process.cwd(), services),
		).toThrow("no configured fagent response for input: unknown");
		expect(() =>
			runFagent(["--config", configPath, "--print", "READ missing.txt"], root, services),
		).toThrow("failed to read missing.txt");
		expect(() =>
			runFagent(["--config", configPath, "--bogus", "value", "--print", "ping"], root, services),
		).toThrow("unsupported argv token: --bogus");
	});

	test("drives the deterministic MVP Pithos task workflow", async () => {
		const root = await mkdtemp(join(tmpdir(), "fagent-workflow-"));
		const dbPath = join(root, "pithos.sqlite");
		const eventLogPath = join(root, "events.jsonl");
		pithos(dbPath, ["init", "--fresh"]);
		const repoScope = pithos(dbPath, ["scope", "upsert", "--kind", "repo", "--path", process.cwd()])
			.scope as Record<string, unknown>;
		const repoScopeId = String(repoScope.id);
		for (const [run, agent, mode, scope] of [
			["run_pandora", "pandora", "hitl", "global"],
			["run_toil", "toil", "afk", "global"],
			["run_war_1", "war", "afk", repoScopeId],
			["run_war_2", "war", "afk", repoScopeId],
		] as const) {
			pithos(dbPath, [
				"run",
				"upsert",
				"--run",
				run,
				"--agent",
				agent,
				"--mode",
				mode,
				"--scope",
				scope,
				"--cwd",
				process.cwd(),
				"--harness-kind",
				"fagent",
				"--session-log-path",
				join(root, `${run}.jsonl`),
				"--session-id",
				run,
			]);
		}
		pithos(
			dbPath,
			[
				"task",
				"enqueue",
				"--run",
				"run_pandora",
				"--scope",
				"global",
				"--capability",
				"triage",
				"--title",
				"triage",
				"--stdin",
				"--chain",
				"none",
			],
			"triage body",
		);
		const configPath = join(root, "fagent.json");
		await writeFile(
			configPath,
			JSON.stringify({
				scripts: {
					toil: {
						agentKind: "toil",
						capability: "triage",
						pithosPath: pithosBin,
						eventLogPath,
						executeScopeId: repoScopeId,
						actions: ["claim", "enqueue_execute", "complete"],
					},
					war_fail: {
						agentKind: "war",
						capability: "execute",
						pithosPath: pithosBin,
						eventLogPath,
						actions: ["claim", "fail_execute_once"],
					},
					pandora: {
						agentKind: "pandora",
						capability: "escalate",
						pithosPath: pithosBin,
						eventLogPath,
						actions: ["claim", "repair_replay"],
						hitl: true,
					},
					war_done: {
						agentKind: "war",
						capability: "execute",
						pithosPath: pithosBin,
						eventLogPath,
						actions: ["claim", "complete"],
					},
				},
			}),
			"utf8",
		);

		expect(
			runScript(dbPath, ["--config", configPath, "--print", "toil"], process.cwd(), {
				PITHOS_RUN_ID: "run_toil",
				PITHOS_SCOPE_ID: "global",
			}),
		).toBe("FAGENT_SCRIPT_DONE");
		expect(
			runScript(dbPath, ["--config", configPath, "--print", "war_fail"], process.cwd(), {
				PITHOS_RUN_ID: "run_war_1",
				PITHOS_SCOPE_ID: repoScopeId,
			}),
		).toBe("FAGENT_SCRIPT_DONE");
		expect(
			runScript(dbPath, ["--config", configPath, "--print", "pandora"], process.cwd(), {
				PITHOS_RUN_ID: "run_pandora",
				PITHOS_SCOPE_ID: "global",
			}),
		).toBe("FAGENT_HITL_READY");
		expect(
			runScript(dbPath, ["--config", configPath, "--print", "war_done"], process.cwd(), {
				PITHOS_RUN_ID: "run_war_2",
				PITHOS_SCOPE_ID: repoScopeId,
			}),
		).toBe("FAGENT_SCRIPT_DONE");

		const events = jsonl(eventLogPath);
		expect(events.map((event) => event.action)).toEqual([
			"claim",
			"enqueue_execute",
			"complete",
			"claim",
			"fail_execute_once",
			"claim",
			"repair_replay",
			"claim",
			"complete",
		]);
		expect(
			events.every((event) => event.outcome === "ok" && typeof event.task_id === "string"),
		).toBe(true);
		expect(events.map((event) => event.agent_kind)).toEqual([
			"toil",
			"toil",
			"toil",
			"war",
			"war",
			"pandora",
			"pandora",
			"war",
			"war",
		]);
		expect(events.map((event) => event.run_id)).toEqual([
			"run_toil",
			"run_toil",
			"run_toil",
			"run_war_1",
			"run_war_1",
			"run_pandora",
			"run_pandora",
			"run_war_2",
			"run_war_2",
		]);
		expect(events[1]?.task_id).toBe(events[3]?.task_id);
		expect(events[6]?.task_id).toBe(events[3]?.task_id);
		const finalWarTask = pithos(dbPath, [
			"task",
			"inspect",
			"--json",
			String(events.at(-1)?.task_id),
		]).task as Record<string, unknown>;
		expect(finalWarTask.status).toBe("done");
	});

	test("Pandora-style HITL CLI remains resident after scripted action", async () => {
		const root = await mkdtemp(join(tmpdir(), "fagent-hitl-"));
		const dbPath = join(root, "pithos.sqlite");
		const eventLogPath = join(root, "events.jsonl");
		pithos(dbPath, ["init", "--fresh"]);
		pithos(dbPath, [
			"run",
			"upsert",
			"--run",
			"run_pandora",
			"--agent",
			"pandora",
			"--mode",
			"hitl",
			"--scope",
			"global",
			"--cwd",
			process.cwd(),
			"--harness-kind",
			"fagent",
			"--session-log-path",
			join(root, "p.jsonl"),
			"--session-id",
			"p",
		]);
		pithos(
			dbPath,
			[
				"task",
				"enqueue",
				"--run",
				"run_pandora",
				"--scope",
				"global",
				"--capability",
				"escalate",
				"--title",
				"hello",
				"--stdin",
				"--chain",
				"none",
			],
			"hello",
		);
		const configPath = join(root, "fagent.json");
		await writeFile(
			configPath,
			JSON.stringify({
				scripts: {
					pandora: {
						agentKind: "pandora",
						capability: "escalate",
						pithosPath: pithosBin,
						eventLogPath,
						actions: ["claim"],
						hitl: true,
					},
				},
			}),
			"utf8",
		);
		const child = spawn(
			resolve(process.cwd(), "bin/fagent"),
			["--config", configPath, "--print", "pandora"],
			{
				env: {
					...process.env,
					PITHOS_DB: dbPath,
					PITHOS_RUN_ID: "run_pandora",
					PITHOS_SCOPE_ID: "global",
				},
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		const ready = await new Promise<string>((resolveReady) =>
			child.stdout.once("data", (chunk: Buffer) => resolveReady(chunk.toString("utf8"))),
		);
		expect(ready).toContain("FAGENT_HITL_READY");
		const exitedEarly = await Promise.race([
			new Promise<boolean>((resolveExit) => child.once("exit", () => resolveExit(true))),
			new Promise<boolean>((resolveTimer) => setTimeout(() => resolveTimer(false), 100)),
		]);
		expect(exitedEarly).toBe(false);
		child.kill();
		await new Promise((resolveClose) => child.once("close", resolveClose));
	});

	test("CLI failures exit non-zero with clear stderr", async () => {
		const { configPath } = await makeFixture("cli-failure");

		const result = spawnSync(
			resolve(process.cwd(), "bin/fagent"),
			["--config", configPath, "--print", "unknown"],
			{ encoding: "utf8" },
		);

		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain(
			"NO_RESPONSE: no configured fagent response for input: unknown",
		);
	});
});
