import { Effect } from "effect";
import {
	appendFile,
	chmod,
	mkdir,
	open,
	readdir,
	readFile,
	readlink,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { execFile, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
	bundledAgentsPath,
	bundledDataDirResourcesDir,
	bundledTemplatesDir,
	bundledUserDataDirResourcesDir,
	launchRenderedAgent,
	LiveSpawnerServices as liveSpawnerServices,
	renderAgent,
	renderSessionTranscript,
	SpawnerError,
} from "@pdx/spawner";
import { liveServices, makeEngine, pickThreeWords, PithosError } from "@pdx/pithos";
import type { Config as PithosConfig } from "@pdx/pithos";
import { PdxError } from "./errors.js";
import { makeGitRepoLaunchChecks } from "./repo-launch-checks.js";
import {
	FileSystem,
	Clock,
	Ids,
	PithosClient,
	Process,
	RepoLaunchChecks,
	Spawner,
	type PithosClientService,
	type ProcessResult,
} from "./services.js";

const execFileEffect = (
	file: string,
	args: readonly string[],
	options?: { readonly cwd?: string; readonly env?: Record<string, string> },
) =>
	Effect.async<ProcessResult, PdxError>((resume) => {
		execFile(
			file,
			[...args],
			{ cwd: options?.cwd, env: { ...process.env, ...options?.env } },
			(error, stdout, stderr) => {
				if (error !== null && typeof error.code !== "number") {
					resume(
						Effect.fail(
							new PdxError({
								code: "PROCESS_ERROR",
								message: `${file} failed to start: ${error.message}`,
							}),
						),
					);
					return;
				}
				resume(
					Effect.succeed({
						exitCode: typeof error?.code === "number" ? error.code : 0,
						stdout,
						stderr,
					}),
				);
			},
		);
	});

export const ProcessLive = Process.of({
	execFile: execFileEffect,
	foreground: (file, args, options) =>
		Effect.try({
			try: () => {
				const result = spawnSync(file, [...args], {
					cwd: options?.cwd,
					env: { ...process.env, ...options?.env },
					stdio: "inherit",
				});
				if (result.error !== undefined) {
					throw result.error;
				}
				return { exitCode: result.status ?? 0, stdout: "", stderr: "" };
			},
			catch: (error) =>
				new PdxError({
					code: "PROCESS_ERROR",
					message: `${file} foreground failed: ${String(error)}`,
				}),
		}),
	isAlive: (pid) =>
		Effect.gen(function* () {
			try {
				process.kill(pid, 0);
				return true;
			} catch (error) {
				if (
					typeof error === "object" &&
					error !== null &&
					"code" in error &&
					error.code === "ESRCH"
				) {
					return false;
				}
				return yield* Effect.fail(
					new PdxError({
						code: "PROCESS_ERROR",
						message: `probe ${pid} failed: ${String(error)}`,
					}),
				);
			}
		}),
	kill: (pid, signal) =>
		Effect.try({
			try: () => void process.kill(pid, signal),
			catch: (error) =>
				new PdxError({
					code: "PROCESS_ERROR",
					message: `kill ${pid} ${signal} failed: ${String(error)}`,
				}),
		}),
});
export const RepoLaunchChecksLive = RepoLaunchChecks.of(makeGitRepoLaunchChecks(ProcessLive));
const fsError = (operation: string, error: unknown) =>
	new PdxError({ code: "FS_ERROR", message: `${operation} failed: ${String(error)}` });

export const FileSystemLive = FileSystem.of({
	appendFile: (path, content) =>
		Effect.tryPromise({
			try: () => appendFile(path, content),
			catch: (error) => fsError("appendFile", error),
		}),
	readFile: (path) =>
		Effect.tryPromise({
			try: () => readFile(path, "utf8"),
			catch: (error) => fsError("readFile", error),
		}),
	readFileIfExists: (path) =>
		Effect.tryPromise({
			try: async () => {
				try {
					return await readFile(path, "utf8");
				} catch (error) {
					if (isNodeErrorCode(error, "ENOENT")) return undefined;
					throw error;
				}
			},
			catch: (error) => fsError("readFileIfExists", error),
		}),
	readDirectory: (path) =>
		Effect.tryPromise({
			try: () => readdir(path),
			catch: (error) => fsError("readDirectory", error),
		}),
	existsDirectory: (path) =>
		Effect.tryPromise({
			try: async () => {
				try {
					return (await stat(path)).isDirectory();
				} catch (error) {
					if (isNodeErrorCode(error, "ENOENT")) return false;
					throw error;
				}
			},
			catch: (error) => fsError("existsDirectory", error),
		}),
	mkdir: (path) =>
		Effect.tryPromise({
			try: () => mkdir(path, { recursive: true }),
			catch: (error) => fsError("mkdir", error),
		}).pipe(Effect.asVoid),
	writeFileAtomic: (path, content) =>
		Effect.tryPromise({
			try: async () => {
				const tmpPath = `${path}.tmp`;
				await writeFile(tmpPath, content, "utf8");
				await rename(tmpPath, path);
			},
			catch: (error) => fsError("writeFileAtomic", error),
		}).pipe(Effect.asVoid),
	removeFile: (path) =>
		Effect.tryPromise({
			try: async () => {
				try {
					await rm(path, { force: true, recursive: true });
				} catch (error) {
					if (!isNodeErrorCode(error, "EACCES") && !isNodeErrorCode(error, "EPERM")) throw error;
					await chmodTree(path, 0o755);
					await rm(path, { force: true, recursive: true });
				}
			},
			catch: (error) => fsError("removeFile", error),
		}).pipe(Effect.asVoid),
});
export const ClockLive = Clock.of({ nowIso: Effect.sync(() => new Date().toISOString()) });
export const IdsLive = Ids.of({
	nextRunId: Effect.sync(() => `run_${pickThreeWords()}`),
	nextSessionId: Effect.sync(() => randomUUID()),
});
const pithosError = (operation: string, error: unknown) => {
	if (error instanceof PdxError) return error;
	if (error instanceof PithosError) {
		return new PdxError({ code: error.code, message: `${operation} failed: ${error.message}` });
	}
	return new PdxError({ code: "PROCESS_ERROR", message: `${operation} failed: ${String(error)}` });
};

const pithosClient = (dbPath: string): PithosClientService => {
	const engine = makeEngine({
		config: { dbPath } satisfies PithosConfig,
		services: liveServices,
	});
	const run = <A>(operation: string, f: () => A) =>
		Effect.try({ try: f, catch: (error) => pithosError(operation, error) });
	return {
		init: () => run("pithos init", () => void engine.init({ fresh: false })),
		scopeUpsert: (input) =>
			run(
				"pithos scope upsert",
				() =>
					void engine.scopeUpsert({
						kind: input.kind,
						path: input.path,
						parentRepoPath: input.parentRepoPath,
						description: input.description,
					}),
			),
		runUpsert: (input) =>
			run(
				"pithos run upsert",
				() =>
					void engine.runUpsert({
						agent: input.agent,
						mode: input.mode,
						scope: input.scope,
						cwd: input.cwd,
						sessionId: input.sessionId,
						harnessKind: input.harnessKind,
						sessionLogPath: input.sessionLogPath,
						runId: input.runId,
					}),
			),
		runCleanup: (input) => run("pithos run cleanup", () => void engine.runCleanup(input)),
		runInterrupt: (input) =>
			run("pithos run interrupt", () => {
				const interruptInput =
					input.expectedRunId === undefined
						? { runId: input.runId, taskId: input.taskId, reason: input.reason }
						: {
								runId: input.runId,
								taskId: input.taskId,
								reason: input.reason,
								expectedRunId: input.expectedRunId,
							};
				const result = engine.runInterrupt(interruptInput);
				return { run: result.run, interruptedTask: result.interrupted_task };
			}),
		runTimeout: (input) => run("pithos run timeout", () => void engine.runTimeout(input)),
		runLaunchAbort: (input) =>
			run("pithos run launch abort", () => void engine.runLaunchAbort(input)),
		runInspect: (input) => run("pithos run inspect", () => engine.runInspect(input).run),
		activeRunForTask: (input) =>
			run("pithos active run for task", () => engine.activeRunForTask(input).run),
		taskInspect: (input) => run("pithos task inspect", () => engine.taskInspect(input)),
		taskHeartbeat: (input) =>
			run(
				"pithos task heartbeat",
				() => void engine.heartbeat({ runId: input.runId, taskId: undefined, token: undefined }),
			),
		taskEnqueue: (input) =>
			run(
				"pithos task enqueue",
				() =>
					void engine.enqueue({
						scope: input.scope,
						capability: input.capability,
						title: input.title,
						body: input.body,
						bodyFile: undefined,
						runId: input.runId,
						after: input.dependsOn ?? [],
						chain: "auto",
					}),
			),
		escalateLaunchPrecondition: (input) =>
			run(
				"pithos launch precondition escalation",
				() => void engine.escalateLaunchPrecondition(input),
			),
		createRepairAlert: (input) =>
			run("pithos repair alert", () => void engine.createRepairAlert(input)),
		claimableRepairAlertKinds: () =>
			run("pithos repair alert kinds", () => engine.claimableRepairAlertKinds().kinds),
		briefing: () => run("pithos briefing", () => engine.briefing({ agent: undefined }).ready),
		pruneEvents: () => run("pithos prune events", () => engine.pruneEvents()),
	};
};

export const makePithosClientLive = (dbPath: string) => PithosClient.of(pithosClient(dbPath));
const spawnerError = (operation: string, error: unknown) => {
	if (error instanceof PdxError) return error;
	if (error instanceof SpawnerError) {
		const code =
			error.code === "VALIDATION_ERROR"
				? "VALIDATION_ERROR"
				: error.code === "TEMPLATE_ERROR"
					? "CONFIG_ERROR"
					: error.code === "HARNESS_ERROR"
						? "HARNESS_ERROR"
						: "LAUNCH_ERROR";
		return new PdxError({
			code,
			message: `${operation} failed (${error.code}): ${error.message}`,
		});
	}
	return new PdxError({ code: "PROCESS_ERROR", message: `${operation} failed: ${String(error)}` });
};

const isNodeErrorCode = (error: unknown, code: string): boolean =>
	typeof error === "object" && error !== null && "code" in error && error.code === code;

const chmodTree = async (path: string, mode: number): Promise<void> => {
	const pathStat = await stat(path);
	if (!pathStat.isDirectory()) {
		await chmod(path, mode);
		return;
	}
	const entries = await readdir(path, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.isDirectory()) await chmodTree(join(path, entry.name), mode);
		else await chmod(join(path, entry.name), mode);
	}
	await chmod(path, mode);
};

const copyBundledTemplates = async (sourceDir: string, targetDir: string): Promise<void> => {
	const entries = await readdir(sourceDir, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name === "agents.toml") continue;
		const sourcePath = join(sourceDir, entry.name);
		const targetPath = join(targetDir, entry.name);
		if (entry.isDirectory()) {
			await mkdir(targetPath, { recursive: true });
			await copyBundledTemplates(sourcePath, targetPath);
			await chmod(targetPath, 0o555);
		} else if (entry.isFile()) {
			const content = await readFile(sourcePath, "utf8");
			await writeFile(targetPath, content, "utf8");
			await chmod(targetPath, 0o444);
		} else if (entry.isSymbolicLink()) {
			await symlink(await readlink(sourcePath), targetPath);
		}
	}
};

const ensureUserScaffold = async (userDataDir: string): Promise<void> => {
	await mkdir(userDataDir, { recursive: true });
	const writeIfMissing = async (path: string, content: string): Promise<void> => {
		try {
			await stat(path);
		} catch (error) {
			if (!isNodeErrorCode(error, "ENOENT")) throw error;
			await writeFile(path, content, "utf8");
		}
	};
	await writeIfMissing(
		join(userDataDir, "AGENTS.md"),
		await readFile(join(bundledUserDataDirResourcesDir, "AGENTS.md"), "utf8"),
	);
	await writeIfMissing(
		join(userDataDir, "CLAUDE.md"),
		await readFile(join(bundledUserDataDirResourcesDir, "CLAUDE.md"), "utf8"),
	);
	await writeIfMissing(
		join(userDataDir, "agents.toml"),
		await readFile(join(bundledUserDataDirResourcesDir, "agents.toml"), "utf8"),
	);
	await writeIfMissing(
		join(userDataDir, "artifacts.toml"),
		await readFile(join(bundledUserDataDirResourcesDir, "artifacts.toml"), "utf8"),
	);
	await writeIfMissing(
		join(userDataDir, "supervisor.toml"),
		await readFile(join(bundledUserDataDirResourcesDir, "supervisor.toml"), "utf8"),
	);
	await writeFile(
		join(userDataDir, "PANDORA.md"),
		await readFile(join(bundledUserDataDirResourcesDir, "PANDORA.md"), "utf8"),
		"utf8",
	);
};

// Full re-seed: used by materializeTemplates() on pdx init/open.
const reseedSpawnerTemplates = async (dataDir: string, userDataDir: string): Promise<void> => {
	const targetDir = join(dataDir, "templates");
	// Make the dir writable before wiping so rm -rf can remove files from it
	try {
		await chmodTree(targetDir, 0o755);
	} catch (error) {
		if (!isNodeErrorCode(error, "ENOENT")) throw error;
	}
	await rm(targetDir, { recursive: true, force: true });
	try {
		await chmod(join(dataDir, "agents.toml"), 0o644);
	} catch (error) {
		if (!isNodeErrorCode(error, "ENOENT")) throw error;
	}
	try {
		await chmod(join(dataDir, "AGENTS.md"), 0o644);
	} catch (error) {
		if (!isNodeErrorCode(error, "ENOENT")) throw error;
	}
	await mkdir(targetDir, { recursive: true });
	await copyBundledTemplates(bundledTemplatesDir, targetDir);
	await writeFile(join(dataDir, "agents.toml"), await readFile(bundledAgentsPath, "utf8"), "utf8");
	await writeFile(
		join(dataDir, "AGENTS.md"),
		await readFile(join(bundledDataDirResourcesDir, "AGENTS.md"), "utf8"),
		"utf8",
	);
	await chmod(join(dataDir, "agents.toml"), 0o444);
	await chmod(join(dataDir, "AGENTS.md"), 0o444);
	await chmod(targetDir, 0o555);
	await ensureUserScaffold(userDataDir);
};

export const makeSpawnerLive = (config: {
	readonly dataDir: string;
	readonly userDataDir: string;
	readonly pithosDbPath: string;
}) => {
	const existsDirectory = liveSpawnerServices.existsDirectory ?? (() => false);
	const readDir = liveSpawnerServices.readDir;
	const renderServices = {
		readText: liveSpawnerServices.readText,
		...(readDir === undefined ? {} : { readDir }),
		existsDirectory,
		env: (key: string) => {
			if (key === "PDX_DATA_DIR") return config.dataDir;
			if (key === "PDX_USER_DATA_DIR") return config.userDataDir;
			if (key === "PITHOS_DB") return config.pithosDbPath;
			return liveSpawnerServices.env(key);
		},
		execFile: liveSpawnerServices.execFile,
		realPath: liveSpawnerServices.realPath,
		writeTempText: liveSpawnerServices.writeTempText,
	};
	return Spawner.of({
		materializeTemplates: () =>
			Effect.tryPromise({
				try: () => reseedSpawnerTemplates(config.dataDir, config.userDataDir),
				catch: (error) => spawnerError("spawner template materialize", error),
			}),
		renderAgent: (input) =>
			Effect.try({
				try: () => renderAgent(input, renderServices),
				catch: (error) => spawnerError("spawner render", error),
			}),
		launchRenderedAgent: (rendered) =>
			Effect.tryPromise({
				try: async () => {
					const stdoutPath = `${config.dataDir}/runs/${rendered.runId}.stdout.log`;
					const stderrPath = `${config.dataDir}/runs/${rendered.runId}.stderr.log`;
					await Promise.all([writeFile(stdoutPath, "", "utf8"), writeFile(stderrPath, "", "utf8")]);
					const [stdout, stderr] = await Promise.all([
						open(stdoutPath, "a"),
						open(stderrPath, "a"),
					]);
					try {
						return launchRenderedAgent(rendered, {
							...renderServices,
							spawnProcess: (file, args, options) => {
								const child = spawn(file, args, {
									cwd: options.cwd,
									env: {
										...process.env,
										PDX_DATA_DIR: config.dataDir,
										PDX_USER_DATA_DIR: config.userDataDir,
										PITHOS_DB: config.pithosDbPath,
										...options.env,
									},
									stdio: ["ignore", stdout.fd, stderr.fd],
									detached: false,
								});
								return child.pid === undefined ? {} : { pid: child.pid };
							},
							execFile: liveSpawnerServices.execFile,
						});
					} finally {
						await Promise.all([stdout.close(), stderr.close()]);
					}
				},
				catch: (error) => spawnerError("spawner launch", error),
			}),
		renderSessionTranscript: (input) =>
			Effect.try({
				try: () =>
					input.limit === undefined
						? renderSessionTranscript(
								{ harnessKind: input.harnessKind, sessionLogPath: input.sessionLogPath },
								renderServices,
							)
						: renderSessionTranscript(
								{
									harnessKind: input.harnessKind,
									sessionLogPath: input.sessionLogPath,
									limit: input.limit,
								},
								renderServices,
							),
				catch: (error) => spawnerError("spawner transcript", error),
			}),
	});
};
