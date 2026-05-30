import { CliConfig, Command, HelpDoc } from "@effect/cli";
import * as ValidationError from "@effect/cli/ValidationError";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Console as EffectConsole, Effect, Layer } from "effect";
import { makeSpawnerCommand, renderSpawnerCustomHelp, type PreviewInput } from "./cli.js";
import { SpawnerError, exitCodeFor, type ErrorCode } from "./errors.js";
import { renderAgent } from "./spawner.js";

const writeText = (value: string): void => {
	process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
};

const writeJson = (value: unknown): void => {
	writeText(JSON.stringify(value, null, 2));
};

const writeError = (code: ErrorCode, message: string): void => {
	process.stderr.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`);
};

const validationErrorMessage = (error: ValidationError.ValidationError): string =>
	HelpDoc.toAnsiText(error.error).trim();

const writeConsoleLine = (args: readonly unknown[]): void => {
	writeText(args.map(String).join(" "));
};

const writeConsoleEffect = (...args: readonly unknown[]): Effect.Effect<void> =>
	Effect.sync(() => writeConsoleLine(args));

const writeConsoleUnsafe = (...args: readonly unknown[]): void => writeConsoleLine(args);

const quietErrorUnsafeConsole: EffectConsole.UnsafeConsole = {
	assert: () => undefined,
	clear: () => undefined,
	count: () => undefined,
	countReset: () => undefined,
	debug: writeConsoleUnsafe,
	dir: writeConsoleUnsafe,
	dirxml: writeConsoleUnsafe,
	error: () => undefined,
	group: writeConsoleUnsafe,
	groupCollapsed: writeConsoleUnsafe,
	groupEnd: () => undefined,
	info: writeConsoleUnsafe,
	log: writeConsoleUnsafe,
	table: writeConsoleUnsafe,
	time: () => undefined,
	timeEnd: () => undefined,
	timeLog: writeConsoleUnsafe,
	trace: writeConsoleUnsafe,
	warn: writeConsoleUnsafe,
};

const quietErrorConsole: EffectConsole.Console = {
	[EffectConsole.TypeId]: EffectConsole.TypeId,
	assert: () => Effect.void,
	clear: Effect.void,
	count: () => Effect.void,
	countReset: () => Effect.void,
	debug: writeConsoleEffect,
	dir: writeConsoleEffect,
	dirxml: writeConsoleEffect,
	error: () => Effect.void,
	group: writeConsoleEffect,
	groupEnd: Effect.void,
	info: writeConsoleEffect,
	log: writeConsoleEffect,
	table: writeConsoleEffect,
	time: () => Effect.void,
	timeEnd: () => Effect.void,
	timeLog: writeConsoleEffect,
	trace: writeConsoleEffect,
	warn: writeConsoleEffect,
	unsafe: quietErrorUnsafeConsole,
};

const preview = (input: PreviewInput): Effect.Effect<void, SpawnerError> =>
	Effect.try({
		try: () => renderAgent(input),
		catch: (error) =>
			error instanceof SpawnerError
				? error
				: new SpawnerError({
						code: "LAUNCH_ERROR",
						message: error instanceof Error ? error.message : String(error),
					}),
	}).pipe(
		Effect.tap((rendered) => Effect.sync(() => writeJson(rendered))),
		Effect.asVoid,
	);

const command = makeSpawnerCommand(preview);

const customHelp = renderSpawnerCustomHelp(command, process.argv.slice(2));
if (customHelp !== undefined) {
	writeText(customHelp);
	process.exit(0);
}

if (process.argv.slice(2).includes("--version")) {
	writeText("0.1.0");
	process.exit(0);
}

const cli = Command.run(command, {
	name: "Pandora's Box Spawner",
	version: "0.1.0",
	executable: "pandora-spawn",
});

const program = EffectConsole.withConsole(cli(process.argv), quietErrorConsole).pipe(
	Effect.catchTag("SpawnerError", (error) =>
		Effect.sync(() => {
			writeError(error.code, error.message);
			process.exit(exitCodeFor(error.code));
		}),
	),
	Effect.catchAll((error: unknown) =>
		ValidationError.isValidationError(error)
			? Effect.sync(() => {
					writeError("VALIDATION_ERROR", validationErrorMessage(error));
					process.exit(2);
				})
			: Effect.sync(() => {
					const message = error instanceof Error ? error.message : String(error);
					writeError("LAUNCH_ERROR", message);
					process.exit(1);
				}),
	),
	Effect.provide(Layer.mergeAll(NodeContext.layer, CliConfig.layer({ showBuiltIns: true }))),
);

NodeRuntime.runMain(program);
