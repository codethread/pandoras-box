import { execFile } from "node:child_process";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { parsePdxConfig } from "../src/config.js";
import { PdxError } from "../src/errors.js";
import {
	Clock,
	FileSystem,
	Ids,
	LifecycleReporter,
	PithosClient,
	Process,
	Registry,
	RepoLaunchChecks,
	Spawner,
	SupervisorLog,
	Tmux,
	type FileSystemService,
	type LaunchAgentInput,
	type LaunchAgentResult,
	type PithosClientService,
	type ProcessService,
	type RegistryService,
	type SpawnerService,
	type TmuxService,
} from "../src/services.js";
import { type Capability, type Services as PithosServices } from "@pdx/pithos";
import { PANDORA_TARGET, reconcileTick } from "../src/controller.js";
import type { RepoLaunchChecksService } from "../src/repo-launch-checks.js";

export const execFileAsync = promisify(execFile);
export const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

export const runPdxCli = (args: readonly string[], env?: NodeJS.ProcessEnv) =>
	execFileAsync(
		process.execPath,
		["packages/pdx/scripts/build.mjs", "--dev", "--run", "--", ...args],
		{
			cwd: repoRoot,
			env: {
				...process.env,
				PDX_DATA_DIR: undefined,
				PDX_USER_DATA_DIR: undefined,
				...env,
			},
		},
	);

export const makeFakeTmux = async () => {
	const binDir = await mkdtemp(join(tmpdir(), "pdx-tmux-"));
	const tmuxPath = join(binDir, "tmux");
	await writeFile(
		tmuxPath,
		`#!/bin/sh
cmd="$1"
shift
case "$cmd" in
  has-session)
    if [ "$1" = "-t" ] && [ "$2" = "pdx--daemon" ] && [ "$PDX_TEST_TMUX_MODE" = "daemon-up" ]; then
      exit 0
    fi
    printf '%s\n' 'no server running on /tmp/tmux-test/default' >&2
    exit 1
    ;;
  switch-client|attach)
    if [ "$1" = "-t" ]; then
      printf '%s:%s\n' "$cmd" "$2" >> "$PDX_TEST_TMUX_LOG"
      exit 0
    fi
    ;;
esac
printf 'unexpected tmux args: %s\n' "$cmd $*" >&2
exit 64
`,
		"utf8",
	);
	await chmod(tmuxPath, 0o755);
	return {
		binDir,
		env: (overrides: NodeJS.ProcessEnv = {}) => ({
			...process.env,
			PATH: `${binDir}:${process.env.PATH ?? ""}`,
			PDX_TEST_TMUX_LOG: join(binDir, "tmux.log"),
			...overrides,
		}),
	};
};

export const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.runPromise(effect as Effect.Effect<A, E, never>);

export const configInput = (
	dataDir: string | undefined,
	envHome: string | undefined,
	envDataDir?: string,
	envUserDataDir?: string,
) => ({
	dataDir,
	envDataDir,
	envUserDataDir,
	envHome,
	daemonEntrypoint: "/tmp/pdx-dev",
});

export const parseConfig = (dataDir: string, envHome = "/tmp/user-home") =>
	run(parsePdxConfig(configInput(dataDir, envHome)));

export interface ReadyTaskInput {
	readonly id?: string;
	readonly scope_id: string;
	readonly capability: Capability;
	readonly scope_kind?: "global" | "repo" | "worktree";
	readonly canonical_path?: string | null;
	readonly parent_repo_path?: string | null;
}

export const runOutput = (
	overrides: {
		readonly id?: string;
		readonly agent?: string;
		readonly mode?: "afk" | "hitl";
		readonly scope_id?: string;
		readonly status?: string;
		readonly task_id?: string | null;
		readonly session_id?: string;
		readonly harness_kind?: "claude" | "pi" | "system";
		readonly session_log_path?: string;
		readonly has_claimed_task?: boolean;
	} = {},
) => ({
	id: overrides.id ?? "run_test",
	agent: overrides.agent ?? "pandora",
	mode: overrides.mode ?? "hitl",
	scope_id: overrides.scope_id ?? "global",
	status: overrides.status ?? "running",
	task_id: overrides.task_id ?? null,
	session_id: overrides.session_id ?? "session_test",
	harness_kind: overrides.harness_kind ?? "pi",
	session_log_path: overrides.session_log_path ?? "/tmp/session_test.jsonl",
	has_claimed_task: overrides.has_claimed_task ?? false,
	created_at: "2026-05-09T00:00:00.000Z",
	updated_at: "2026-05-09T00:00:00.000Z",
});

export const makePithos = (
	calls: string[] = [],
	ready: readonly ReadyTaskInput[] | (() => readonly ReadyTaskInput[]) = [],
	overrides: Partial<PithosClientService> = {},
) => {
	const getReady = typeof ready === "function" ? ready : () => ready;
	const base: PithosClientService = {
		init: () => Effect.sync(() => calls.push("init")),
		scopeUpsert: (input) => Effect.sync(() => calls.push(`scopeUpsert:${input.kind}`)),
		runUpsert: (input) =>
			Effect.sync(() => calls.push(`runUpsert:${input.agent}:${input.runId ?? "new"}`)),
		runCleanup: (input) =>
			Effect.sync(() => calls.push(`runCleanup:${input.runId}:${input.reason}`)),
		runInterrupt: (input) =>
			Effect.sync(() => {
				calls.push(`runInterrupt:${input.runId ?? input.taskId}:${input.reason}`);
				return {
					run: runOutput({
						id: input.runId ?? "run_for_task",
						agent: "greed",
						mode: "afk",
						scope_id: "scope_repo",
						status: "failed",
					}),
					interruptedTask: { id: input.taskId ?? "task_held", scope_id: "scope_repo" },
				};
			}),
		runTimeout: (input) =>
			Effect.sync(() => calls.push(`runTimeout:${input.runId}:${input.reason}`)),
		runLaunchAbort: (input) =>
			Effect.sync(() => calls.push(`runLaunchAbort:${input.runId}:${input.reason}`)),
		runInspect: (input) => Effect.succeed(runOutput({ id: input.runId })),
		activeRunForTask: () =>
			Effect.succeed(
				runOutput({
					id: "run_for_task",
					agent: "greed",
					mode: "afk",
					scope_id: "scope_repo",
					task_id: "task_held",
				}),
			),
		taskInspect: (input) => {
			const r = getReady();
			const match =
				r.find((task, index) => (task.id ?? `task_ready_${index}`) === input.taskId) ?? r[0];
			return Effect.succeed({
				task: {
					id: input.taskId,
					status: "queued",
					scope_id: match?.scope_id ?? "scope_repo",
					capability: match?.capability ?? "execute",
					// no ready fixture: fall back to a repo path; otherwise mirror the
					// briefing fake, where an omitted canonical_path means null
					canonical_path: match === undefined ? "/repo" : (match.canonical_path ?? null),
				},
			});
		},
		taskHeartbeat: (input) => Effect.sync(() => calls.push(`taskHeartbeat:${input.runId}`)),
		taskEnqueue: (input) =>
			Effect.sync(() => calls.push(`taskEnqueue:${input.capability}:${input.title}`)),
		escalateLaunchPrecondition: (input) =>
			Effect.sync(() =>
				calls.push(
					`escalateLaunchPrecondition:${input.expectedTaskId}:${input.expectedScopeId}:${input.canonicalPath}`,
				),
			),
		createRepairAlert: (input) =>
			Effect.sync(() =>
				calls.push(
					`createRepairAlert:${input.affectedTaskId ?? "none"}:${input.kind}:${input.escalationTitle}`,
				),
			),
		claimableRepairAlertKinds: () => Effect.succeed([]),
		briefing: () =>
			Effect.succeed(
				getReady().map((task, index) => ({
					id: task.id ?? `task_ready_${index}`,
					scope_kind: task.scope_kind ?? "global",
					canonical_path: task.canonical_path ?? null,
					parent_repo_path: task.parent_repo_path ?? null,
					...task,
				})),
			),
		pruneEvents: () =>
			Effect.sync(() => {
				calls.push("pruneEvents");
				return { ok: true as const, deleted_heartbeat: 0, deleted_other: 0 };
			}),
	};
	return PithosClient.of({ ...base, ...overrides });
};

const baseTmuxImpl: TmuxService = {
	hasSession: () => Effect.succeed(true),
	lsSessions: () => Effect.succeed([]),
	newSession: () => Effect.void,
	killSession: () => Effect.void,
	switchClient: () => Effect.void,
	attachSession: () => Effect.void,
	sendLiteralLine: () => Effect.void,
	pasteBuffer: () => Effect.void,
	presence: () => Effect.succeed({ attached: 0, lastActivityUnix: null as number | null }),
};

const baseProcessImpl: ProcessService = {
	execFile: () => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
	isAlive: () => Effect.succeed(true),
	kill: () => Effect.void,
};

const baseRepoLaunchChecksImpl: RepoLaunchChecksService = {
	probeDefaultBranch: () =>
		Effect.succeed({
			_tag: "OnDefaultBranch" as const,
			path: "/repo",
			gitRoot: "/repo",
			currentBranch: "main",
			defaultBranch: "main",
		}),
};

const baseFsImpl: FileSystemService = {
	appendFile: () => Effect.void,
	readFile: () => Effect.succeed(""),
	readFileIfExists: () => Effect.succeed(undefined),
	readDirectory: () => Effect.succeed([]),
	existsDirectory: () => Effect.succeed(true),
	mkdir: () => Effect.void,
	writeFileAtomic: () => Effect.void,
	removeFile: () => Effect.void,
};

export const fakeTmux = (overrides: Partial<TmuxService> = {}): ReturnType<typeof Tmux.of> =>
	Tmux.of({ ...baseTmuxImpl, ...overrides });

export const fakeProcess = (
	overrides: Partial<ProcessService> = {},
): ReturnType<typeof Process.of> => Process.of({ ...baseProcessImpl, ...overrides });

export const fakeRepoLaunchChecks = (
	overrides: Partial<RepoLaunchChecksService> = {},
): ReturnType<typeof RepoLaunchChecks.of> =>
	RepoLaunchChecks.of({ ...baseRepoLaunchChecksImpl, ...overrides });

export const fakeFs = (
	overrides: Partial<FileSystemService> = {},
): ReturnType<typeof FileSystem.of> => FileSystem.of({ ...baseFsImpl, ...overrides });

export const alwaysLiveTmux = fakeTmux();

export const alwaysLiveProcess = fakeProcess();

export const testLog = SupervisorLog.of({
	write: (record) => Effect.succeed({ ts: "now", ...record }),
});
export const testLifecycle = LifecycleReporter.of({ report: () => Effect.void });
export const stripAnsi = (text: string): string =>
	[
		"\u001b[32m",
		"\u001b[33m",
		"\u001b[31m",
		"\u001b[34m",
		"\u001b[1m",
		"\u001b[2m",
		"\u001b[0m",
	].reduce((value, code) => value.split(code).join(""), text);

export const testClock = Clock.of({ nowIso: Effect.succeed("2026-05-09T00:00:31.000Z") });

export const noopFs = fakeFs();

export const pithosTestServices = (): PithosServices => {
	let counter = 0;
	return {
		fs: {
			readText: () => Effect.succeed("{}"),
			removeFile: () => Effect.void,
			existsDirectory: () => Effect.succeed(true),
		},
		input: { readStdin: () => Effect.succeed({ _tag: "NoRedirectedStdin" as const }) },
		output: { write: () => Effect.void, writeError: () => Effect.void, isTty: () => false },
		ids: {
			make: (prefix) =>
				Effect.sync(() => {
					counter += 1;
					return `${prefix}_${counter}`;
				}),
		},
		clock: { nowIso: () => Effect.succeed("2026-05-09T00:00:00.000Z") },
	};
};

export const makeSpawner = (input: {
	readonly launchAgent: (
		launch: LaunchAgentInput,
	) => Effect.Effect<
		Partial<LaunchAgentResult> & LaunchAgentInput & { readonly logicalName: string },
		PdxError
	>;
	readonly renderSessionTranscript?: SpawnerService["renderSessionTranscript"];
}) =>
	Spawner.of({
		materializeTemplates: () => Effect.void,
		renderAgent: (launch) =>
			Effect.succeed({
				...launch,
				logicalName: launch.agent === "pandora" ? PANDORA_TARGET : `pdx--${launch.agent}`,
				harness: { kind: "pi", argv: ["pi", launch.runId], env: { PITHOS_RUN_ID: launch.runId } },
				sessionLogPath: `/tmp/${launch.runId}.jsonl`,
				prompt: "test prompt",
			}),
		launchRenderedAgent: (rendered) =>
			input.launchAgent(rendered).pipe(
				Effect.map((launched) => ({
					...launched,
					harnessKind: rendered.harness.kind,
					sessionLogPath: rendered.sessionLogPath,
				})),
			),
		renderSessionTranscript:
			input.renderSessionTranscript ?? (() => Effect.succeed("test transcript\n")),
	});

export const upsertPandora = (registry: RegistryService) =>
	registry.upsert({
		runId: "run_pandora",
		agent: "pandora",
		scopeId: "global",
		mode: "hitl",
		state: "live",
		logicalName: PANDORA_TARGET,
		tmuxTarget: PANDORA_TARGET,
	});

interface TickInput {
	readonly config: Awaited<ReturnType<typeof parseConfig>>;
	readonly registry: RegistryService;
	readonly pithos?: PithosClientService;
	readonly tmux?: ReturnType<typeof Tmux.of>;
	readonly process?: ReturnType<typeof Process.of>;
	readonly repoLaunchChecks?: ReturnType<typeof RepoLaunchChecks.of>;
	readonly log?: ReturnType<typeof SupervisorLog.of>;
	readonly lifecycle?: ReturnType<typeof LifecycleReporter.of>;
	readonly clock?: ReturnType<typeof Clock.of>;
	readonly fs?: FileSystemService;
	readonly ids?: ReturnType<typeof Ids.of>;
	readonly spawner?: ReturnType<typeof Spawner.of>;
	readonly maxAfk?: number;
	readonly tickEffect?: (
		config: Awaited<ReturnType<typeof parseConfig>>,
	) => Effect.Effect<void, PdxError, TickRequirements>;
}

type TickRequirements = Effect.Effect.Context<ReturnType<typeof reconcileTick>>;

export const runTick = (input: TickInput) => {
	const effect = input.tickEffect
		? input.tickEffect(input.config)
		: reconcileTick(input.config, input.maxAfk);
	return run(
		effect.pipe(
			Effect.provideService(Registry, input.registry),
			Effect.provideService(PithosClient, input.pithos ?? makePithos()),
			Effect.provideService(
				Ids,
				input.ids ??
					Ids.of({
						nextRunId: Effect.succeed("run_war"),
						nextSessionId: Effect.succeed("session_war"),
					}),
			),
			Effect.provideService(
				Spawner,
				input.spawner ??
					makeSpawner({
						launchAgent: () =>
							Effect.fail(new PdxError({ code: "PROCESS_ERROR", message: "unexpected launch" })),
					}),
			),
			Effect.provideService(Tmux, input.tmux ?? alwaysLiveTmux),
			Effect.provideService(Process, input.process ?? alwaysLiveProcess),
			Effect.provideService(RepoLaunchChecks, input.repoLaunchChecks ?? fakeRepoLaunchChecks()),
			Effect.provideService(SupervisorLog, input.log ?? testLog),
			Effect.provideService(LifecycleReporter, input.lifecycle ?? testLifecycle),
			Effect.provideService(FileSystem, input.fs ?? noopFs),
			Effect.provideService(Clock, input.clock ?? testClock),
		),
	);
};

export const runSpawnTick = async (input: {
	readonly dataDir: string;
	readonly registry: RegistryService;
	readonly pithos: PithosClientService;
	readonly launches: unknown[];
	readonly maxAfk?: number;
	readonly runId?: string;
	readonly sessionId?: string;
	readonly fs?: FileSystemService;
	readonly repoLaunchChecks?: ReturnType<typeof RepoLaunchChecks.of>;
	readonly launchAgent?: (
		launch: LaunchAgentInput,
	) => Effect.Effect<
		Partial<LaunchAgentResult> & LaunchAgentInput & { readonly logicalName: string },
		PdxError
	>;
}) => {
	const config = await parseConfig(input.dataDir);
	return runTick({
		config,
		registry: input.registry,
		pithos: input.pithos,
		...(input.maxAfk !== undefined ? { maxAfk: input.maxAfk } : {}),
		ids: Ids.of({
			nextRunId: Effect.succeed(input.runId ?? "run_war"),
			nextSessionId: Effect.succeed(input.sessionId ?? "session_war"),
		}),
		spawner: makeSpawner({
			launchAgent:
				input.launchAgent ??
				((launch) =>
					Effect.sync(() => {
						input.launches.push(launch);
						return launch.mode === "hitl"
							? {
									...launch,
									logicalName: `pdx--${launch.agent}`,
									hitl: { tmuxTarget: `pdx--${launch.agent}`, panePid: 1 },
								}
							: {
									...launch,
									logicalName: `pdx--${launch.agent}`,
									afk: { pid: 456, processStartTime: "now" },
								};
					})),
		}),
		...(input.fs !== undefined ? { fs: input.fs } : {}),
		...(input.repoLaunchChecks !== undefined ? { repoLaunchChecks: input.repoLaunchChecks } : {}),
	});
};
