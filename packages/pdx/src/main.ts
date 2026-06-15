import { CliConfig, Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { networkInterfaces } from "node:os";
import process from "node:process";
import { inspect } from "node:util";
import {
	closePdx,
	DAEMON_TARGET,
	initPdx,
	killPdx,
	logsShowPdx,
	openPdx,
	PANDORA_TARGET,
	runDaemon,
	runShowPdx,
	runTranscriptPdx,
	statusPdx,
	taskShowPdx,
	uiPdx,
} from "./controller.js";
import {
	defaultMaxAfk,
	makePdxCommand,
	maybeRenderPdxHelpJson,
	parseInternalDaemonRun,
	renderPdxCustomHelp,
	type CommandInput,
} from "./cli.js";
import { parsePdxConfig } from "./config.js";
import { PdxError } from "./errors.js";
import {
	BrowserLive,
	ClockLive,
	FileSystemLive,
	HttpLive,
	IdsLive,
	makePithosClientLive,
	makeSpawnerLive,
	ProcessLive,
	SignalsLive,
} from "./live.js";
import { makeSupervisorLog } from "./log.js";
import { makeNoopLifecycleReporter, makeStdoutLifecycleReporter } from "./lifecycle.js";
import {
	Browser,
	Clock,
	FileSystem,
	Http,
	Ids,
	LifecycleReporter,
	makeRegistry,
	PithosClient,
	Process,
	Registry,
	Signals,
	Spawner,
	SupervisorLog,
	Tmux,
} from "./services.js";
import { makeTmux } from "./tmux.js";

interface RuntimeInput {
	readonly envDataDir: string | undefined;
	readonly envUserDataDir: string | undefined;
	readonly envHome: string | undefined;
	readonly envTmux: string | undefined;
	readonly daemonEntrypoint: string | undefined;
}

const json = (value: unknown): string => `${JSON.stringify(value)}\n`;

const writePdxError = (code: PdxError["code"], message: string) => {
	process.stderr.write(json({ ok: false, error: { code, message } }));
	process.exitCode = 2;
};

const captureRuntimeInput = Effect.sync<RuntimeInput>(() => ({
	envDataDir: process.env.PDX_DATA_DIR,
	envUserDataDir: process.env.PDX_USER_DATA_DIR,
	envHome: process.env.HOME,
	envTmux: process.env.TMUX,
	daemonEntrypoint: process.argv[1],
}));

const baseLayer = Layer.mergeAll(
	Layer.succeed(Process, ProcessLive),
	Layer.succeed(FileSystem, FileSystemLive),
	Layer.succeed(Clock, ClockLive),
	Layer.succeed(Browser, BrowserLive),
	Layer.succeed(Http, HttpLive),
	Layer.succeed(Signals, SignalsLive),
	Layer.succeed(Ids, IdsLive),
);

const firstLanAddress = (): string | undefined => {
	for (const entries of Object.values(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.internal || entry.family !== "IPv4") continue;
			return entry.address;
		}
	}
	return undefined;
};

const uiDisplayUrl = (info: {
	readonly url: string;
	readonly host: string;
	readonly port: number;
}): string => {
	if (info.host !== "0.0.0.0") return info.url;
	const lanAddress = firstLanAddress();
	return lanAddress === undefined ? info.url : `http://${lanAddress}:${String(info.port)}`;
};

const latestSupervisorError = (raw: string): string | undefined => {
	const lines = raw.trimEnd().split("\n").reverse();
	for (const line of lines) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		if (typeof parsed !== "object" || parsed === null) continue;
		const record = parsed as Record<string, unknown>;
		const data = record.data;
		if (typeof data === "object" && data !== null) {
			const error = (data as Record<string, unknown>).error;
			if (typeof error === "string" && error.length > 0) return error;
		}
	}
	return undefined;
};

const runCommand = (runtime: RuntimeInput, input: CommandInput) =>
	Effect.gen(function* () {
		const config = yield* parsePdxConfig({
			dataDir: input.dataDir,
			envDataDir: runtime.envDataDir,
			envUserDataDir: runtime.envUserDataDir,
			envHome: runtime.envHome,
			daemonEntrypoint: runtime.daemonEntrypoint,
		});
		const tmux = yield* makeTmux;
		const fs = yield* FileSystem;
		const supervisorLog = yield* makeSupervisorLog(config.logPath);
		const registry = yield* makeRegistry;
		const clock = yield* Clock;
		const lifecycleReporter =
			input.command === "daemon.run"
				? makeStdoutLifecycleReporter(clock)
				: makeNoopLifecycleReporter();
		const provided = Layer.mergeAll(
			Layer.succeed(Tmux, tmux),
			Layer.succeed(SupervisorLog, supervisorLog),
			Layer.succeed(LifecycleReporter, lifecycleReporter),
			Layer.succeed(Registry, registry),
			Layer.succeed(PithosClient, makePithosClientLive(config.pithosDbPath)),
			Layer.succeed(Spawner, makeSpawnerLive(config)),
		);

		switch (input.command) {
			case "init":
				yield* initPdx(config, { clean: input.clean, nuke: input.nuke }).pipe(
					Effect.provide(provided),
				);
				yield* Effect.sync(() =>
					process.stdout.write(
						[
							"Pandora's Box initialized.",
							`Data dir: ${config.dataDir}`,
							`User config dir: ${config.userDataDir}`,
							"",
							"Next: configure your agents, then run `pdx open` to release Pandora.",
							"",
							`  cd ${config.userDataDir}`,
							`  claude "help me set up agents.toml"`,
							'  # or: pi "help me set up agents.toml"',
						].join("\n") + "\n",
					),
				);
				return;
			case "open": {
				yield* openPdx(config, input.maxAfk, input.intervalSeconds, {
					clean: input.clean,
					nuke: input.nuke,
				}).pipe(Effect.provide(provided));
				const pandoraStarted = yield* tmux.hasSession(PANDORA_TARGET);
				if (!pandoraStarted) {
					const detail = yield* fs.readFile(config.logPath).pipe(
						Effect.map(latestSupervisorError),
						Effect.catchAll(() => Effect.succeed(undefined)),
					);
					yield* tmux.killSession(DAEMON_TARGET).pipe(Effect.catchAll(() => Effect.void));
					yield* Effect.fail(
						new PdxError({
							code: "PANDORA_STARTUP_FAILED",
							message: `Pandora failed to start. Check user config at ${config.userDataDir}/agents.toml.${detail === undefined ? " Run 'pandora-spawn preview' to validate the configured Harness." : ` ${detail}`}`,
						}),
					);
				}
				if (runtime.envTmux === undefined) {
					yield* tmux.attachSession(PANDORA_TARGET);
				} else {
					yield* tmux.switchClient(PANDORA_TARGET);
				}
				return;
			}
			case "ui":
				return yield* uiPdx(config, {
					host: input.host,
					port: input.port,
					noOpen: input.noOpen,
					onReady: (info) =>
						Effect.sync(() => {
							const displayUrl = uiDisplayUrl(info);
							process.stdout.write(`Graph explorer running at ${displayUrl}\n`);
							if (displayUrl !== info.url) {
								process.stdout.write(`Bound address: ${info.url}\n`);
							}
							process.stdout.write("Press Ctrl+C to stop.\n");
						}),
				}).pipe(Effect.provide(provided));
			case "close":
				return yield* closePdx(config).pipe(Effect.provide(provided));
			case "daemon.status": {
				const status = yield* statusPdx(config, defaultMaxAfk).pipe(Effect.provide(provided));
				yield* Effect.sync(() => process.stdout.write(`${JSON.stringify(status)}\n`));
				return;
			}
			case "run.kill":
				yield* killPdx(config, {
					runId: input.runId,
					taskId: undefined,
					reason: input.reason,
				}).pipe(Effect.provide(provided));
				return;
			case "task.kill":
				yield* killPdx(config, {
					runId: undefined,
					taskId: input.taskId,
					reason: input.reason,
				}).pipe(Effect.provide(provided));
				return;
			case "daemon.logs": {
				const outputText = yield* logsShowPdx(config, {
					limit: input.limit,
					all: input.all,
					since: input.since,
				}).pipe(Effect.provide(provided));
				yield* Effect.sync(() => process.stdout.write(outputText));
				return;
			}
			case "run.transcript": {
				const transcript = yield* runTranscriptPdx({
					runId: input.runId,
					limit: input.limit,
				}).pipe(Effect.provide(provided));
				yield* Effect.sync(() => process.stdout.write(transcript));
				return;
			}
			case "run.show": {
				const confirmation = yield* runShowPdx(config, { runId: input.runId }).pipe(
					Effect.provide(provided),
				);
				yield* Effect.sync(() => process.stdout.write(json(confirmation)));
				return;
			}
			case "task.show": {
				const confirmation = yield* taskShowPdx(config, { taskId: input.taskId }).pipe(
					Effect.provide(provided),
				);
				yield* Effect.sync(() => process.stdout.write(json(confirmation)));
				return;
			}
			case "daemon.run": {
				const handle = yield* runDaemon(config, input.maxAfk, input.intervalSeconds).pipe(
					Effect.provide(provided),
				);
				yield* handle.shutdown;
				yield* handle.close;
				return;
			}
		}
	}).pipe(Effect.provide(baseLayer));

const handleError = (error: unknown): Effect.Effect<void, unknown> => {
	if (error instanceof PdxError) {
		return Effect.sync(() => writePdxError(error.code, error.message));
	}
	return Effect.fail(error);
};

const program = captureRuntimeInput.pipe(
	Effect.flatMap((runtime) =>
		Effect.gen(function* () {
			const internal = yield* parseInternalDaemonRun(process.argv);
			if (internal !== undefined) {
				yield* runCommand(runtime, internal);
				return;
			}
			const command = makePdxCommand((input) => runCommand(runtime, input));
			const helpJson = yield* maybeRenderPdxHelpJson(process.argv, command);
			if (helpJson !== undefined) {
				process.stdout.write(helpJson);
				return;
			}
			const customHelp = renderPdxCustomHelp(process.argv, command);
			if (customHelp !== undefined) {
				process.stdout.write(customHelp);
				return;
			}
			const cli = Command.run(command, {
				name: "Pdx",
				version: "0.1.1",
				executable: "pdx",
			});
			yield* cli(process.argv).pipe(Effect.catchAll((error) => handleError(error)));
		}),
	),
	Effect.catchAll((error) =>
		Effect.sync(() => {
			const message = error instanceof Error ? error.message : inspect(error);
			writePdxError("VALIDATION_ERROR", message);
		}),
	),
	Effect.provide(Layer.mergeAll(NodeContext.layer, CliConfig.layer({ showBuiltIns: false }))),
);

NodeRuntime.runMain(program);
