import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePdxConfig } from "../src/config.js";
import { runPdxCli, makeFakeTmux, run, configInput, parseConfig } from "./support.js";

describe("pdx cli and config", () => {
	it("prints machine-readable JSON help with nested pdx command paths", async () => {
		const { stdout } = await runPdxCli(["--help-json"]);
		const help = JSON.parse(stdout) as {
			readonly tool: string;
			readonly fullPath: string;
			readonly usage: string;
			readonly description: string;
			readonly subcommands: readonly {
				readonly fullPath: string;
				readonly subcommands: readonly {
					readonly fullPath: string;
					readonly subcommands: readonly unknown[];
				}[];
			}[];
		};
		const paths: string[] = [];
		const collect = (command: {
			readonly fullPath: string;
			readonly subcommands: readonly unknown[];
		}) => {
			paths.push(command.fullPath);
			for (const child of command.subcommands) {
				collect(child as { readonly fullPath: string; readonly subcommands: readonly unknown[] });
			}
		};
		collect(help);
		expect(help.tool).toBe("pdx");
		expect(help.fullPath).toBe("pdx");
		expect(help.usage).toContain("pdx");
		expect(help.description).toContain("Local supervisor");
		expect(paths).toEqual(
			expect.arrayContaining([
				"pdx ui",
				"pdx daemon status",
				"pdx daemon logs",
				"pdx run transcript",
				"pdx run show",
				"pdx task show",
			]),
		);
	});

	it("keeps default help human-readable", async () => {
		const { stdout } = await runPdxCli(["--help"]);
		expect(() => {
			JSON.parse(stdout);
		}).toThrow();
		expect(stdout).toMatchSnapshot();
	});

	it("CLI init materializes templates without tmux", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-cli-init-"));
		const userDataDir = join(dataDir, "config");
		const tmux = await makeFakeTmux();
		const { stdout } = await runPdxCli(["init", "--data-dir", dataDir], {
			...tmux.env(),
			PDX_USER_DATA_DIR: userDataDir,
		});
		expect(stdout).toBe(
			[
				"Pandora's Box initialized.",
				`Data dir: ${dataDir}`,
				`User config dir: ${userDataDir}`,
				"",
				"Next: configure your agents, then run `pdx open` to release Pandora.",
				"",
				`  cd ${userDataDir}`,
				`  claude "help me set up agents.toml"`,
				`  # or: pi "help me set up agents.toml"`,
			].join("\n") + "\n",
		);
		expect(existsSync(join(dataDir, "pithos.sqlite"))).toBe(true);
		expect(await readFile(join(dataDir, "agents.toml"), "utf8")).toContain("[agents.pandora]");
		expect(await readFile(join(dataDir, "AGENTS.md"), "utf8")).toContain(
			"pdx runtime directory note",
		);
		expect(await readFile(join(userDataDir, "AGENTS.md"), "utf8")).toContain(
			"See `PANDORA.md` for the installed configuration reference.",
		);
		expect(await readFile(join(userDataDir, "CLAUDE.md"), "utf8")).toContain(
			"See `PANDORA.md` for the installed configuration reference.",
		);
		const userManifest = await readFile(join(userDataDir, "agents.toml"), "utf8");
		expect(userManifest).toContain("User-wide Pandora's Box manifest partial.");
		expect(userManifest).toContain("[policies.git-flow]");
		expect(userManifest).toContain('[policy]\n# add = ["git-flow"]');
		expect(userManifest).toContain("[[rules]]");
		expect(userManifest).toContain("[agents.greed.harness]");
		expect(userManifest).not.toContain("[hooks.input]");
		const userReference = await readFile(join(userDataDir, "PANDORA.md"), "utf8");
		expect(userReference).toContain("Pandora's Box config reference");
		expect(userReference).toContain("--scope-kind repo");
		expect(userReference).toContain('--scope-path "$PWD"');
		expect(existsSync(join(dataDir, "CLAUDE.md"))).toBe(false);
		expect(existsSync(join(dataDir, "runs"))).toBe(true);
		expect(existsSync(join(tmux.binDir, "tmux.log"))).toBe(false);
	});

	it("CLI init --nuke removes read-only seeded templates while preserving user artifacts", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "pdx-cli-nuke-"));
		const userDataDir = join(dataDir, "config");
		const tmux = await makeFakeTmux();
		await runPdxCli(["init", "--data-dir", dataDir], {
			...tmux.env(),
			PDX_USER_DATA_DIR: userDataDir,
		});
		await writeFile(join(userDataDir, "artifacts.toml"), "# custom artifact contract\n", "utf8");
		await runPdxCli(["init", "--data-dir", dataDir, "--nuke"], {
			...tmux.env(),
			PDX_USER_DATA_DIR: userDataDir,
		});
		expect(await readFile(join(userDataDir, "artifacts.toml"), "utf8")).toBe(
			"# custom artifact contract\n",
		);
		expect(await readFile(join(dataDir, "templates", "agents", "war.md"), "utf8")).not.toHaveLength(
			0,
		);
	});

	it("CLI open rejects --clean with --nuke", async () => {
		await expect(
			runPdxCli(["open", "--clean", "--nuke", "--data-dir", "/tmp/pdx-home"]),
		).rejects.toMatchObject({
			code: 2,
			stdout: "",
			stderr: `${JSON.stringify({
				ok: false,
				error: {
					code: "VALIDATION_ERROR",
					message: "--clean and --nuke are mutually exclusive",
				},
			})}\n`,
		});
	});

	it("derives config paths from data dir", async () => {
		const config = await parseConfig("/tmp/pdx-home");
		expect(config).toMatchObject({
			dataDir: "/tmp/pdx-home",
			socketPath: "/tmp/pdx-home/pdx.sock",
			intakeSocketPath: "/tmp/pdx-home/intake.sock",
			logPath: "/tmp/pdx-home/pdx.jsonl",
			runsDir: "/tmp/pdx-home/runs",
		});
	});

	it.each([
		{
			name: "explicit --data-dir without HOME env",
			input: configInput("/tmp/pdx-home", undefined),
			field: "dataDir" as const,
			expected: "/tmp/pdx-home",
		},
		{
			name: "PDX_DATA_DIR env before HOME default",
			input: configInput(undefined, "/tmp/user-home", "/tmp/pdx-env"),
			field: "dataDir" as const,
			expected: "/tmp/pdx-env",
		},
		{
			name: "HOME-only env falls back to ~/.pdx",
			input: configInput(undefined, "/tmp/user-home"),
			field: "dataDir" as const,
			expected: "/tmp/user-home/.pdx",
		},
		{
			name: "explicit --data-dir overrides PDX_DATA_DIR env",
			input: configInput("/tmp/pdx-explicit", "/tmp/user-home", "/tmp/pdx-env"),
			field: "dataDir" as const,
			expected: "/tmp/pdx-explicit",
		},
		{
			name: "defaults userDataDir under dataDir/config",
			input: configInput("/tmp/pdx-home", "/tmp/user-home"),
			field: "userDataDir" as const,
			expected: "/tmp/pdx-home/config",
		},
		{
			name: "explicit PDX_USER_DATA_DIR outside the data dir",
			input: configInput("/tmp/pdx-home", "/tmp/user-home", undefined, "/tmp/shared-pdx-config"),
			field: "userDataDir" as const,
			expected: "/tmp/shared-pdx-config",
		},
		{
			name: "expands ~/ PDX_USER_DATA_DIR with HOME",
			input: configInput("/tmp/pdx-home", "/tmp/user-home", undefined, "~/pdx-config"),
			field: "userDataDir" as const,
			expected: "/tmp/user-home/pdx-config",
		},
		{
			name: "expands bare ~ PDX_USER_DATA_DIR to HOME",
			input: configInput("/tmp/pdx-home", "/tmp/user-home", undefined, "~"),
			field: "userDataDir" as const,
			expected: "/tmp/user-home",
		},
	])("resolves config: $name", async ({ input, field, expected }) => {
		const config = await run(parsePdxConfig(input));
		expect(config[field]).toBe(expected);
	});

	it("rejects invalid PDX_USER_DATA_DIR relationships and missing data dir", async () => {
		await expect(
			run(
				parsePdxConfig(configInput("/tmp/pdx-home", "/tmp/user-home", undefined, "/tmp/pdx-home")),
			),
		).rejects.toThrow(/must not equal PDX_DATA_DIR/);
		await expect(
			run(parsePdxConfig(configInput("/tmp/pdx-home", "/tmp/user-home", undefined, "/tmp"))),
		).rejects.toThrow(/must not be an ancestor/);
		await expect(
			run(
				parsePdxConfig(
					configInput("/tmp/pdx-home", "/tmp/user-home", undefined, "/tmp/pdx-home/nested"),
				),
			),
		).rejects.toThrow(/only allowed at \/tmp\/pdx-home\/config/);
		await expect(run(parsePdxConfig({ daemonEntrypoint: "/tmp/pdx-dev" }))).rejects.toThrow(
			/missing required data dir/,
		);
	});
});
