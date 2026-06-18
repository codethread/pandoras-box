import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { FileSystem, PithosClient, Spawner } from "../src/services.js";
import { makeSpawnerLive } from "../src/live.js";
import { initPdx } from "../src/controller.js";
import { run, parseConfig, makePithos, fakeFs } from "./support.js";

describe("pdx init and template materialization", () => {
	it("init creates data dir, pithos DB, runs dir, and bundle templates without tmux", async () => {
		const config = await parseConfig("/tmp/pdx-init");
		const calls: string[] = [];
		const fs = fakeFs({
			mkdir: (path) => Effect.sync(() => calls.push(`mkdir:${path}`)),
			removeFile: (path) => Effect.sync(() => calls.push(`remove:${path}`)),
		});
		const pithos = makePithos(calls);
		const spawner = Spawner.of({
			materializeTemplates: () => Effect.sync(() => calls.push("materializeTemplates")),
			renderAgent: () => Effect.die("unexpected render"),
			launchRenderedAgent: () => Effect.die("unexpected launch"),
			renderSessionTranscript: () => Effect.die("unexpected transcript"),
		});
		await run(
			initPdx(config, { clean: false, nuke: false }).pipe(
				Effect.provideService(FileSystem, fs),
				Effect.provideService(PithosClient, pithos),
				Effect.provideService(Spawner, spawner),
			),
		);
		expect(calls).toEqual([
			"mkdir:/tmp/pdx-init",
			"init",
			"mkdir:/tmp/pdx-init/runs",
			"materializeTemplates",
			"scopeUpsert:repo",
		]);
	});

	it("init --clean wipes DB, runs dir, and log before re-seeding", async () => {
		const config = await parseConfig("/tmp/pdx-clean");
		const calls: string[] = [];
		const fs = fakeFs({
			mkdir: (path) => Effect.sync(() => calls.push(`mkdir:${path}`)),
			removeFile: (path) => Effect.sync(() => calls.push(`remove:${path}`)),
		});
		const pithos = makePithos(calls);
		const spawner = Spawner.of({
			materializeTemplates: () => Effect.sync(() => calls.push("materializeTemplates")),
			renderAgent: () => Effect.die("unexpected render"),
			launchRenderedAgent: () => Effect.die("unexpected launch"),
			renderSessionTranscript: () => Effect.die("unexpected transcript"),
		});
		await run(
			initPdx(config, { clean: true, nuke: false }).pipe(
				Effect.provideService(FileSystem, fs),
				Effect.provideService(PithosClient, pithos),
				Effect.provideService(Spawner, spawner),
			),
		);
		expect(calls).toEqual([
			`remove:${config.pithosDbPath}`,
			`remove:${config.runsDir}`,
			`remove:${config.logPath}`,
			`remove:${config.socketPath}`,
			`remove:${config.intakeSocketPath}`,
			"mkdir:/tmp/pdx-clean",
			"init",
			"mkdir:/tmp/pdx-clean/runs",
			"materializeTemplates",
			"scopeUpsert:repo",
		]);
	});

	it("init --nuke preserves default nested user config while clearing sibling entries", async () => {
		const config = await parseConfig("/tmp/pdx-nuke");
		const calls: string[] = [];
		const fs = fakeFs({
			readDirectory: (path) =>
				Effect.succeed(path === config.dataDir ? ["config", "runs", "pithos.sqlite"] : []),
			mkdir: (path) => Effect.sync(() => calls.push(`mkdir:${path}`)),
			removeFile: (path) => Effect.sync(() => calls.push(`remove:${path}`)),
		});
		const pithos = makePithos(calls);
		const spawner = Spawner.of({
			materializeTemplates: () => Effect.sync(() => calls.push("materializeTemplates")),
			renderAgent: () => Effect.die("unexpected render"),
			launchRenderedAgent: () => Effect.die("unexpected launch"),
			renderSessionTranscript: () => Effect.die("unexpected transcript"),
		});
		await run(
			initPdx(config, { clean: false, nuke: true }).pipe(
				Effect.provideService(FileSystem, fs),
				Effect.provideService(PithosClient, pithos),
				Effect.provideService(Spawner, spawner),
			),
		);
		expect(calls).toEqual([
			"remove:/tmp/pdx-nuke/runs",
			"remove:/tmp/pdx-nuke/pithos.sqlite",
			"mkdir:/tmp/pdx-nuke",
			"init",
			"mkdir:/tmp/pdx-nuke/runs",
			"materializeTemplates",
			"scopeUpsert:repo",
		]);
	});

	it("renders fails fast for invalid PDX_USER_DATA_DIR even when templates are present", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-spawner-"));
		const bootstrap = makeSpawnerLive({
			dataDir,
			userDataDir: join(dataDir, "config"),
			pithosDbPath: join(dataDir, "pithos.sqlite"),
		});
		await run(bootstrap.materializeTemplates());
		await chmod(join(dataDir, "agents.toml"), 0o644);
		await writeFile(
			join(dataDir, "agents.toml"),
			`[agents.pandora]\n\ttemplate = "agents/pandora.md"\n\n[agents.pandora.harness]\n\tkind = "pi"\n\tmodel = "openai-codex/gpt-5.4"\n\tsystem_prompt_mode = "append"\n\n[agents.toil]\n\ttemplate = "agents/toil.md"\n\n[agents.toil.harness]\n\tkind = "pi"\n\tmodel = "openai-codex/gpt-5.4"\n\tsystem_prompt_mode = "append"\n\n[agents.greed]\n\ttemplate = "agents/greed.md"\n\n[agents.greed.harness]\n\tkind = "pi"\n\tmodel = "openai-codex/gpt-5.4"\n\tsystem_prompt_mode = "append"\n\n[agents.war]\n\ttemplate = "agents/war.md"\n\n[agents.war.harness]\n\tkind = "pi"\n\tmodel = "openai-codex/gpt-5.4"\n\tsystem_prompt_mode = "append"\n\n[agents.envy]\n\ttemplate = "agents/envy.md"\n\n[agents.envy.harness]\n\tkind = "pi"\n\tmodel = "openai-codex/gpt-5.4"\n\tsystem_prompt_mode = "append"\n`,
			"utf8",
		);
		const userDataDir = join(dataDir, "invalid-user-config");
		const spawner = makeSpawnerLive({
			dataDir,
			userDataDir,
			pithosDbPath: join(dataDir, "pithos.sqlite"),
		});
		const error = await run(
			Effect.flip(
				spawner.renderAgent({
					agent: "war",
					mode: "afk",
					runId: "run_test",
					sessionId: "123e4567-e89b-12d3-a456-426614174000",
					scopeId: "scope_repo",
					cwd: "/tmp/repo",
				}),
			),
		);
		expect(error.code).toBe("VALIDATION_ERROR");
		expect(error.message).toContain(
			`PDX_USER_DATA_DIR is not an inspectable directory: ${userDataDir}`,
		);
		expect(await readFile(join(dataDir, "agents.toml"), "utf8")).toContain("[agents.war]");
	});

	it("materializeTemplates seeds bundled spawner templates into the data dir", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-spawner-"));
		const spawner = makeSpawnerLive({
			dataDir,
			userDataDir: join(dataDir, "config"),
			pithosDbPath: join(dataDir, "pithos.sqlite"),
		});
		await run(spawner.materializeTemplates());
		const error = await run(
			Effect.flip(
				spawner.renderAgent({
					agent: "war",
					mode: "afk",
					runId: "run_test",
					sessionId: "not-a-uuid",
					scopeId: "scope_repo",
					cwd: "/tmp/repo",
				}),
			),
		);
		expect(error.code).toBe("VALIDATION_ERROR");
		expect(await readFile(join(dataDir, "agents.toml"), "utf8")).toContain("[agents.pandora]");
		expect(await readFile(join(dataDir, "AGENTS.md"), "utf8")).toContain(
			"pdx runtime directory note",
		);
		expect(await readFile(join(dataDir, "templates", "agents", "war.md"), "utf8")).not.toHaveLength(
			0,
		);
	});

	it("materializes templates as read-only (0555 dir, 0444 files)", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-spawner-"));
		const spawner = makeSpawnerLive({
			dataDir,
			userDataDir: join(dataDir, "config"),
			pithosDbPath: join(dataDir, "pithos.sqlite"),
		});
		await run(spawner.materializeTemplates());
		const templatesDir = join(dataDir, "templates");
		const dirMode = (await stat(templatesDir)).mode & 0o777;
		expect(dirMode).toBe(0o555);
		const agentsMode = (await stat(join(dataDir, "agents.toml"))).mode & 0o777;
		expect(agentsMode).toBe(0o444);
		const dataDirAgentsMode = (await stat(join(dataDir, "AGENTS.md"))).mode & 0o777;
		expect(dataDirAgentsMode).toBe(0o444);
		const warMode = (await stat(join(templatesDir, "agents", "war.md"))).mode & 0o777;
		expect(warMode).toBe(0o444);
	});

	it("re-seeding replaces existing read-only templates", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-spawner-"));
		const spawner = makeSpawnerLive({
			dataDir,
			userDataDir: join(dataDir, "config"),
			pithosDbPath: join(dataDir, "pithos.sqlite"),
		});
		await run(spawner.materializeTemplates());
		// Second call must succeed even though dir is read-only
		await run(spawner.materializeTemplates());
		expect(await readFile(join(dataDir, "agents.toml"), "utf8")).toContain("[agents.pandora]");
	});

	it("materialization scaffolds user config once and re-seeds installed reference docs", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-spawner-"));
		const userDataDir = join(dataDir, "config");
		const spawner = makeSpawnerLive({
			dataDir,
			userDataDir,
			pithosDbPath: join(dataDir, "pithos.sqlite"),
		});
		await run(spawner.materializeTemplates());
		expect(await readFile(join(userDataDir, "artifacts.toml"), "utf8")).toContain(
			"Artifact Contracts are user-owned",
		);
		expect(await readFile(join(userDataDir, "supervisor.toml"), "utf8")).toBe(
			"[launch_preconditions]\nenforce_repo_root_trunk = true\n",
		);
		await writeFile(join(userDataDir, "AGENTS.md"), "custom agent note\n", "utf8");
		await writeFile(join(userDataDir, "CLAUDE.md"), "custom claude note\n", "utf8");
		await writeFile(join(userDataDir, "agents.toml"), "# custom manifest\n", "utf8");
		await writeFile(join(userDataDir, "artifacts.toml"), "# custom artifact contract\n", "utf8");
		await writeFile(join(userDataDir, "supervisor.toml"), "# custom supervisor policy\n", "utf8");
		await writeFile(join(userDataDir, "PANDORA.md"), "stale pandora ref\n", "utf8");
		await chmod(join(dataDir, "AGENTS.md"), 0o644);
		await writeFile(join(dataDir, "AGENTS.md"), "stale runtime note\n", "utf8");
		await run(spawner.materializeTemplates());
		expect(await readFile(join(userDataDir, "AGENTS.md"), "utf8")).toBe("custom agent note\n");
		expect(await readFile(join(userDataDir, "CLAUDE.md"), "utf8")).toBe("custom claude note\n");
		expect(await readFile(join(userDataDir, "agents.toml"), "utf8")).toBe("# custom manifest\n");
		expect(await readFile(join(userDataDir, "artifacts.toml"), "utf8")).toBe(
			"# custom artifact contract\n",
		);
		expect(await readFile(join(userDataDir, "supervisor.toml"), "utf8")).toBe(
			"# custom supervisor policy\n",
		);
		expect(await readFile(join(userDataDir, "PANDORA.md"), "utf8")).toContain(
			"Pandora's Box config reference",
		);
		expect(await readFile(join(dataDir, "AGENTS.md"), "utf8")).toContain(
			"pdx runtime directory note",
		);
	});

	it("maps spawner boundary validation errors without flattening to process errors", async () => {
		const spawner = makeSpawnerLive({
			dataDir: "/tmp/pdx-data",
			userDataDir: "/tmp/pdx-data/config",
			pithosDbPath: "/tmp/pdx.sqlite",
		});
		const error = await run(
			Effect.flip(
				spawner.renderAgent({
					agent: "war",
					mode: "afk",
					runId: "run_test",
					sessionId: "not-a-uuid",
					scopeId: "scope_repo",
					cwd: "/tmp/repo",
				}),
			),
		);
		expect(error.code).toBe("VALIDATION_ERROR");
	});
});
