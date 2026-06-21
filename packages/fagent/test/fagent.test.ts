import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { runFagent, type FagentServices } from "../src/index.js";

const services: FagentServices = {
	readText: (path) => readFileSync(path, "utf8"),
	resolvePath: (cwd, path) => resolve(cwd, path),
};

const makeFixture = async (name: string) => {
	const root = await mkdtemp(join(tmpdir(), `fagent-${name}-`));
	const configPath = join(root, "fagent.json");
	await writeFile(configPath, JSON.stringify({ responses: { ping: "pong" } }), "utf8");
	return { root, configPath };
};

describe("fagent", () => {
	beforeAll(() => {
		const result = spawnSync(process.execPath, ["scripts/build.mjs"], {
			cwd: process.cwd(),
			encoding: "utf8",
		});
		if (result.status !== 0) throw new Error(`failed to build fagent test bin: ${result.stderr}`);
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
