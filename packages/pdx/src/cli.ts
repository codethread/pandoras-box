import { Args, Command, CommandDescriptor, HelpDoc, Options, Usage } from "@effect/cli";
import { Effect, Option } from "effect";
import { PdxError } from "./errors.js";
import { renderHelp } from "./help.js";

export type CommandInput =
	| {
			readonly command: "open";
			readonly dataDir: string | undefined;
			readonly maxAfk: number;
			readonly intervalSeconds: number;
			readonly clean: boolean;
			readonly nuke: boolean;
	  }
	| {
			readonly command: "init";
			readonly dataDir: string | undefined;
			readonly clean: boolean;
			readonly nuke: boolean;
	  }
	| { readonly command: "close"; readonly dataDir: string | undefined }
	| { readonly command: "daemon.status"; readonly dataDir: string | undefined }
	| {
			readonly command: "run.kill";
			readonly dataDir: string | undefined;
			readonly runId: string;
			readonly reason: string;
	  }
	| {
			readonly command: "task.kill";
			readonly dataDir: string | undefined;
			readonly taskId: string;
			readonly reason: string;
	  }
	| {
			readonly command: "daemon.logs";
			readonly dataDir: string | undefined;
			readonly limit: number | undefined;
			readonly all: boolean;
			readonly since: string | undefined;
	  }
	| {
			readonly command: "run.transcript";
			readonly dataDir: string | undefined;
			readonly runId: string;
			readonly limit: number | undefined;
	  }
	| {
			readonly command: "run.show";
			readonly dataDir: string | undefined;
			readonly runId: string;
	  }
	| {
			readonly command: "task.show";
			readonly dataDir: string | undefined;
			readonly taskId: string;
	  }
	| {
			readonly command: "daemon.run";
			readonly dataDir: string | undefined;
			readonly maxAfk: number;
			readonly intervalSeconds: number;
	  };

export const defaultIntervalSeconds = 5;
export const defaultMaxAfk = 4;

const opt = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value);

const parsePositiveInt = (value: number, name: string): Effect.Effect<number, PdxError> => {
	if (!Number.isInteger(value) || value <= 0) {
		return Effect.fail(
			new PdxError({ code: "VALIDATION_ERROR", message: `${name} must be a positive integer` }),
		);
	}
	return Effect.succeed(value);
};

export const parseInternalDaemonRun = (
	argv: readonly string[],
): Effect.Effect<CommandInput | undefined, PdxError> =>
	Effect.gen(function* () {
		if (argv[2] !== "daemon" || argv[3] !== "run") return undefined;
		let dataDir: string | undefined;
		let maxAfk = defaultMaxAfk;
		let intervalSeconds = defaultIntervalSeconds;
		for (let index = 4; index < argv.length; index++) {
			const arg = argv[index]!;
			const value = argv[index + 1];
			if (value === undefined || value.startsWith("--")) {
				yield* Effect.fail(
					new PdxError({ code: "VALIDATION_ERROR", message: `${arg} requires a value` }),
				);
			}
			if (arg === "--data-dir") dataDir = value;
			else if (arg === "--max-afk") maxAfk = yield* parsePositiveInt(Number(value), "--max-afk");
			else if (arg === "--interval-seconds") {
				intervalSeconds = yield* parsePositiveInt(Number(value), "--interval-seconds");
			} else {
				yield* Effect.fail(
					new PdxError({ code: "VALIDATION_ERROR", message: `Unknown option: ${arg}` }),
				);
			}
			index += 1;
		}
		return { command: "daemon.run", dataDir, maxAfk, intervalSeconds } as const;
	});

interface JsonCommandHelp {
	readonly tool: string;
	readonly name: string;
	readonly command: string;
	readonly path: string;
	readonly fullPath: string;
	readonly pathSegments: readonly string[];
	readonly usage: string;
	readonly description: string;
	readonly subcommands: readonly JsonCommandHelp[];
}

const descriptorName = (descriptor: CommandDescriptor.Command<unknown>): string => {
	const node = descriptor as unknown as
		| { readonly _tag: "Standard" | "GetUserInput"; readonly name: string }
		| { readonly _tag: "Map"; readonly command: CommandDescriptor.Command<unknown> }
		| { readonly _tag: "Subcommands"; readonly parent: CommandDescriptor.Command<unknown> };
	switch (node._tag) {
		case "Standard":
		case "GetUserInput":
			return node.name;
		case "Map":
			return descriptorName(node.command);
		case "Subcommands":
			return descriptorName(node.parent);
	}
};

const descriptorDescription = (descriptor: CommandDescriptor.Command<unknown>): string => {
	const node = descriptor as unknown as
		| {
				readonly _tag: "Standard" | "GetUserInput";
				readonly description: HelpDoc.HelpDoc;
		  }
		| { readonly _tag: "Map"; readonly command: CommandDescriptor.Command<unknown> }
		| { readonly _tag: "Subcommands"; readonly parent: CommandDescriptor.Command<unknown> };
	switch (node._tag) {
		case "Standard":
		case "GetUserInput":
			return HelpDoc.toAnsiText(node.description).trim();
		case "Map":
			return descriptorDescription(node.command);
		case "Subcommands":
			return descriptorDescription(node.parent);
	}
};

const descriptorUsage = (
	descriptor: CommandDescriptor.Command<unknown>,
	path: readonly string[],
): string => {
	const ownUsage = HelpDoc.toAnsiText(Usage.getHelp(CommandDescriptor.getUsage(descriptor))).trim();
	const command = path.at(-1);
	const suffix =
		command === undefined || ownUsage === "" || ownUsage === command
			? ""
			: ownUsage.startsWith(`${command} `)
				? ownUsage.slice(command.length + 1)
				: ownUsage;
	return suffix === "" ? path.join(" ") : `${path.join(" ")} ${suffix}`;
};

const descriptorChildren = (
	descriptor: CommandDescriptor.Command<unknown>,
): readonly CommandDescriptor.Command<unknown>[] => {
	const node = descriptor as unknown as
		| { readonly _tag: "Standard" | "GetUserInput" }
		| { readonly _tag: "Map"; readonly command: CommandDescriptor.Command<unknown> }
		| {
				readonly _tag: "Subcommands";
				readonly children: readonly CommandDescriptor.Command<unknown>[];
		  };
	switch (node._tag) {
		case "Standard":
		case "GetUserInput":
			return [];
		case "Map":
			return descriptorChildren(node.command);
		case "Subcommands":
			return node.children;
	}
};

const commandHelpJson = (
	descriptor: CommandDescriptor.Command<unknown>,
	parentPath: readonly string[],
): JsonCommandHelp => {
	const command = descriptorName(descriptor);
	const path = [...parentPath, command];
	const subcommands = descriptorChildren(descriptor)
		.map((child) => commandHelpJson(child, path))
		.sort((left, right) => left.fullPath.localeCompare(right.fullPath));
	const fullPath = path.join(" ");
	return {
		tool: "pdx",
		name: command,
		command,
		path: fullPath,
		fullPath,
		pathSegments: path,
		usage: descriptorUsage(descriptor, path),
		description: descriptorDescription(descriptor),
		subcommands,
	};
};

export const renderPdxHelpJson = <Name extends string, R, E, A>(
	command: Command.Command<Name, R, E, A>,
) => `${JSON.stringify(commandHelpJson(command.descriptor, []), null, 2)}\n`;

export const maybeRenderPdxHelpJson = <Name extends string, R, E, A>(
	argv: readonly string[],
	command: Command.Command<Name, R, E, A>,
): Effect.Effect<string | undefined, PdxError> => {
	const args = argv.slice(2);
	if (!args.includes("--help-json")) return Effect.succeed(undefined);
	if (args.length !== 1) {
		return Effect.fail(
			new PdxError({
				code: "VALIDATION_ERROR",
				message: "--help-json must be the only pdx argument",
			}),
		);
	}
	return Effect.succeed(renderPdxHelpJson(command));
};

export const renderPdxCustomHelp = <Name extends string, R, E, A>(
	argv: readonly string[],
	command: Command.Command<Name, R, E, A>,
): string | undefined => renderHelp(command, argv.slice(2));

const textOption = (name: string, pseudoName: string, description: string) =>
	Options.text(name).pipe(Options.withPseudoName(pseudoName), Options.withDescription(description));

const integerOption = (name: string, pseudoName: string, description: string) =>
	Options.integer(name).pipe(
		Options.withPseudoName(pseudoName),
		Options.withDescription(description),
	);

const textArg = (name: string, description: string) =>
	Args.text({ name }).pipe(Args.withDescription(description));

const dataDirOption = textOption(
	"data-dir",
	"path",
	"Directory containing Pithos state and pdx supervisor logs.",
);

const reasonOption = textOption(
	"reason",
	"reason",
	"Operator-readable reason recorded before pdx kills the live resource.",
);

export const makePdxCommand = (execute: (input: CommandInput) => Effect.Effect<void, PdxError>) => {
	const init = Command.make(
		"init",
		{
			dataDir: dataDirOption.pipe(Options.optional),
			clean: Options.boolean("clean").pipe(
				Options.withDescription(
					"Wipe runtime state only (DB, runs, logs) before init. Templates and extensions are preserved.",
				),
			),
			nuke: Options.boolean("nuke").pipe(
				Options.withDescription("Wipe the entire pdx data dir before init."),
			),
		},
		({ dataDir, clean, nuke }) =>
			Effect.gen(function* () {
				if (clean && nuke) {
					yield* Effect.fail(
						new PdxError({
							code: "VALIDATION_ERROR",
							message: "--clean and --nuke are mutually exclusive",
						}),
					);
				}
				yield* execute({
					command: "init",
					dataDir: opt(dataDir),
					clean,
					nuke,
				});
			}),
	).pipe(Command.withDescription("Initialize the pdx data dir and seeded bundle templates only."));

	const open = Command.make(
		"open",
		{
			dataDir: dataDirOption.pipe(Options.optional),
			maxAfk: integerOption(
				"max-afk",
				"count",
				`Maximum number of supervised AFK Agent runs pdx may keep active. Default: ${defaultMaxAfk.toString()}.`,
			).pipe(Options.withDefault(defaultMaxAfk)),
			intervalSeconds: integerOption(
				"interval-seconds",
				"seconds",
				`Seconds between pdx reconciliation loops. Default: ${defaultIntervalSeconds.toString()}.`,
			).pipe(Options.withDefault(defaultIntervalSeconds)),
			clean: Options.boolean("clean").pipe(
				Options.withDescription(
					"Wipe runtime state only (DB, runs, logs) before starting. Templates and extensions are preserved.",
				),
			),
			nuke: Options.boolean("nuke").pipe(
				Options.withDescription("Wipe the entire pdx data dir before starting."),
			),
		},
		({ dataDir, maxAfk, intervalSeconds, clean, nuke }) =>
			Effect.gen(function* () {
				yield* parsePositiveInt(maxAfk, "--max-afk");
				yield* parsePositiveInt(intervalSeconds, "--interval-seconds");
				if (clean && nuke) {
					yield* Effect.fail(
						new PdxError({
							code: "VALIDATION_ERROR",
							message: "--clean and --nuke are mutually exclusive",
						}),
					);
				}
				yield* execute({
					command: "open",
					dataDir: opt(dataDir),
					maxAfk,
					intervalSeconds,
					clean,
					nuke,
				});
			}),
	).pipe(
		Command.withDescription("Open the box: start pdx supervision and the Pandora HITL singleton."),
	);

	const close = Command.make(
		"close",
		{ dataDir: dataDirOption.pipe(Options.optional) },
		({ dataDir }) => execute({ command: "close", dataDir: opt(dataDir) }),
	).pipe(
		Command.withDescription("Close the box: stop pdx supervision and clean up supervised runs."),
	);

	const daemonStatus = Command.make(
		"status",
		{ dataDir: dataDirOption.pipe(Options.optional) },
		({ dataDir }) => execute({ command: "daemon.status", dataDir: opt(dataDir) }),
	).pipe(Command.withDescription("Show daemon state, supervised agents, and queue counts."));

	const daemonLogs = Command.make(
		"logs",
		{
			dataDir: dataDirOption.pipe(Options.optional),
			limit: integerOption(
				"limit",
				"count",
				"Maximum number of newest supervisor log records to print.",
			).pipe(Options.optional),
			since: textOption(
				"since",
				"timestamp",
				"Only print supervisor log records at or after this timestamp.",
			).pipe(Options.optional),
			all: Options.boolean("all").pipe(
				Options.withDescription("Include all supervisor log records instead of the default limit."),
			),
		},
		({ dataDir, limit, since, all }) =>
			Effect.gen(function* () {
				const parsedLimit = opt(limit);
				if (parsedLimit !== undefined) {
					yield* parsePositiveInt(parsedLimit, "--limit");
				}
				yield* execute({
					command: "daemon.logs",
					dataDir: opt(dataDir),
					limit: parsedLimit,
					all,
					since: opt(since),
				});
			}),
	).pipe(Command.withDescription("Show pdx daemon supervisor JSONL logs (not agent transcripts)."));

	const daemon = Command.make("daemon").pipe(
		Command.withDescription("Daemon supervisor commands."),
		Command.withSubcommands([daemonStatus, daemonLogs]),
	);

	const runKill = Command.make(
		"kill",
		{
			runId: textArg("run-id", "Live or historical pdx-owned Run id."),
			dataDir: dataDirOption.pipe(Options.optional),
			reason: reasonOption,
		},
		({ dataDir, runId, reason }) =>
			execute({ command: "run.kill", dataDir: opt(dataDir), runId, reason }),
	).pipe(Command.withDescription("Kill one live agent run after interrupting Pithos state."));

	const runTranscript = Command.make(
		"transcript",
		{
			runId: textArg("run-id", "Live or historical pdx-owned Run id."),
			dataDir: dataDirOption.pipe(Options.optional),
			limit: integerOption(
				"limit",
				"count",
				"Maximum number of newest Harness transcript events to render.",
			).pipe(Options.optional),
		},
		({ dataDir, runId, limit }) =>
			Effect.gen(function* () {
				const parsedLimit = opt(limit);
				if (parsedLimit !== undefined) {
					yield* parsePositiveInt(parsedLimit, "--limit");
				}
				yield* execute({
					command: "run.transcript",
					dataDir: opt(dataDir),
					runId,
					limit: parsedLimit,
				});
			}),
	).pipe(Command.withDescription("Render an agent harness transcript for a run."));

	const runShow = Command.make(
		"show",
		{
			runId: textArg("run-id", "Live or historical pdx-owned Run id."),
			dataDir: dataDirOption.pipe(Options.optional),
		},
		({ dataDir, runId }) => execute({ command: "run.show", dataDir: opt(dataDir), runId }),
	).pipe(Command.withDescription("Jump the current tmux client to a supervised run session."));

	const run = Command.make("run").pipe(
		Command.withDescription("Inspect or stop supervised agent runs owned by pdx."),
		Command.withSubcommands([runKill, runTranscript, runShow]),
	);

	const taskKill = Command.make(
		"kill",
		{
			taskId: textArg("task-id", "Pithos Task id whose live holder run should be used."),
			dataDir: dataDirOption.pipe(Options.optional),
			reason: textOption(
				"reason",
				"reason",
				"Operator-readable reason recorded before pdx kills the holder run.",
			),
		},
		({ dataDir, taskId, reason }) =>
			execute({ command: "task.kill", dataDir: opt(dataDir), taskId, reason }),
	).pipe(
		Command.withDescription("Kill the live run holding a task after interrupting Pithos state."),
	);

	const taskShow = Command.make(
		"show",
		{
			taskId: textArg("task-id", "Pithos Task id whose live holder run should be used."),
			dataDir: dataDirOption.pipe(Options.optional),
		},
		({ dataDir, taskId }) => execute({ command: "task.show", dataDir: opt(dataDir), taskId }),
	).pipe(Command.withDescription("Jump to the live tmux session holding a task, if any."));

	const task = Command.make("task").pipe(
		Command.withDescription("Operate on live supervision for Pithos tasks."),
		Command.withSubcommands([taskKill, taskShow]),
	);

	return Command.make("pdx").pipe(
		Command.withDescription(
			"Local supervisor for Pandora's Box agent runs, processes, tmux sessions, and Pandora.",
		),
		Command.withSubcommands([init, open, close, daemon, run, task]),
	);
};
