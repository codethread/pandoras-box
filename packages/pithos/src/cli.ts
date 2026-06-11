import process from "node:process";
import { inspect } from "node:util";
import { Args, CliConfig, Command, CommandDescriptor, Options, Usage } from "@effect/cli";
import type { HelpDoc, Span } from "@effect/cli";
import { Effect, Layer, Option } from "effect";
import { NodeContext } from "@effect/platform-node";
import type { Config } from "./config.js";
import {
	makeEngine,
	parseGraphSinceCutoff,
	renderBriefingText,
	renderGraphInspectText,
	renderTaskInspectMarkdown,
} from "./engine.js";
import { exitCodeFor, PithosError } from "./errors.js";
import { BUILTIN_CAPABILITIES } from "./builtins.js";
import type { ChainPolicy } from "./chain-policy.js";
import {
	TASK_STATUSES,
	type Capability,
	type HarnessKind,
	type Mode,
	type ScopeKind,
	type TaskStatus,
} from "./db.js";
import { renderHelp } from "./help.js";
import type { Services } from "./services.js";

export interface CliContext {
	readonly config: Config | (() => Config);
	readonly services: Services;
}

type CommandInput =
	| { readonly command: "init"; readonly fresh: boolean }
	| {
			readonly command: "scope.upsert";
			readonly kind: ScopeKind;
			readonly path: string | undefined;
			readonly parentRepoPath?: string | undefined;
			readonly description?: string | undefined;
	  }
	| { readonly command: "scope.list"; readonly all: boolean }
	| { readonly command: "scope.archive"; readonly scopeId: string }
	| {
			readonly command: "run.upsert";
			readonly agent: string;
			readonly mode: Mode;
			readonly scope: string;
			readonly cwd: string;
			readonly harnessKind: HarnessKind;
			readonly sessionLogPath: string;
			readonly sessionId: string;
			readonly runId: string | undefined;
	  }
	| { readonly command: "run.inspect"; readonly runId: string }
	| { readonly command: "run.cleanup"; readonly runId: string; readonly reason: string }
	| {
			readonly command: "run.interrupt";
			readonly runId: string | undefined;
			readonly taskId: string | undefined;
			readonly reason: string;
	  }
	| { readonly command: "run.timeout"; readonly runId: string; readonly reason: string }
	| { readonly command: "events.tail"; readonly limit: number | undefined }
	| {
			readonly command: "task.enqueue";
			readonly scope: string;
			readonly capability: Capability;
			readonly title: string;
			readonly stdin: boolean;
			readonly runId: string | undefined;
			readonly after: readonly string[];
			readonly gate: readonly string[];
			readonly about: string | undefined;
			readonly repair: string | undefined;
			readonly chain: string;
	  }
	| {
			readonly command: "task.claim";
			readonly runId: string | undefined;
			readonly scope: string;
			readonly capability: Capability;
	  }
	| {
			readonly command: "task.heartbeat";
			readonly runId: string | undefined;
			readonly taskId: string | undefined;
			readonly token: number | undefined;
	  }
	| {
			readonly command: "task.complete";
			readonly taskId: string;
			readonly runId: string | undefined;
			readonly token: number;
			readonly stdin: boolean;
	  }
	| {
			readonly command: "task.fail";
			readonly taskId: string;
			readonly runId: string | undefined;
			readonly token: number;
			readonly reason: string;
	  }
	| {
			readonly command: "task.artifact.add";
			readonly taskId: string;
			readonly runId: string | undefined;
			readonly token: number;
			readonly kind: string;
			readonly title: string;
			readonly stdin: boolean;
	  }
	| { readonly command: "task.inspect"; readonly taskId: string; readonly json: boolean }
	| {
			readonly command: "task.cancel";
			readonly taskId: string;
			readonly runId: string | undefined;
			readonly reason: string;
	  }
	| {
			readonly command: "task.replay";
			readonly taskId: string;
			readonly runId: string | undefined;
			readonly token: number;
			readonly reason: string;
	  }
	| {
			readonly command: "task.supersede";
			readonly taskId: string;
			readonly runId: string | undefined;
			readonly reason: string;
			readonly title: string | undefined;
			readonly stdin: boolean;
			readonly scope: string | undefined;
			readonly capability: Capability | undefined;
	  }
	| {
			readonly command: "graph.inspect";
			readonly taskId: string | undefined;
			readonly scope: string | undefined;
			readonly all: boolean;
			readonly status: readonly string[];
			readonly search: readonly string[];
			readonly since: string | undefined;
			readonly json: boolean;
	  }
	| { readonly command: "briefing"; readonly agent: string | undefined; readonly json: boolean };

const opt = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value);
const json = (value: unknown): string => `${JSON.stringify(value)}\n`;

export interface PithosHelpCommand {
	readonly tool: "pithos";
	readonly name: string;
	readonly path: string;
	readonly usage: string;
	readonly description: string;
	readonly subcommands: readonly PithosHelpCommand[];
}

type CommandDescriptorNode =
	| {
			readonly _tag: "Standard" | "GetUserInput";
			readonly name: string;
			readonly description: HelpDoc.HelpDoc;
	  }
	| { readonly _tag: "Map"; readonly command: CommandDescriptorNode }
	| {
			readonly _tag: "Subcommands";
			readonly parent: CommandDescriptorNode;
			readonly children: readonly CommandDescriptorNode[];
	  };

const HELP_CLI_CONFIG = CliConfig.make({ showBuiltIns: false });

const spanToText = (span: Span.Span): string => {
	switch (span._tag) {
		case "Text":
			return span.value;
		case "URI":
			return span.value;
		case "Sequence":
			return `${spanToText(span.left)}${spanToText(span.right)}`;
		case "Highlight":
		case "Strong":
		case "Weak":
			return spanToText(span.value);
	}
};

const helpDocToText = (helpDoc: HelpDoc.HelpDoc): string => {
	switch (helpDoc._tag) {
		case "Empty":
			return "";
		case "Header":
		case "Paragraph":
			return spanToText(helpDoc.value);
		case "DescriptionList":
			return helpDoc.definitions
				.map(([term, definition]) => `${spanToText(term)} ${helpDocToText(definition)}`.trim())
				.join("\n");
		case "Enumeration":
			return helpDoc.elements.map(helpDocToText).join("\n");
		case "Sequence": {
			const left = helpDocToText(helpDoc.left);
			const right = helpDocToText(helpDoc.right);
			return [left, right].filter((part) => part.length > 0).join("\n");
		}
	}
};

const unwrapCommandDescriptorMap = (node: CommandDescriptorNode): CommandDescriptorNode =>
	node._tag === "Map" ? unwrapCommandDescriptorMap(node.command) : node;

const commandDescriptorName = (node: CommandDescriptorNode): string => {
	const unwrapped = unwrapCommandDescriptorMap(node);
	switch (unwrapped._tag) {
		case "Standard":
		case "GetUserInput":
			return unwrapped.name;
		case "Subcommands":
			return commandDescriptorName(unwrapped.parent);
		case "Map":
			return commandDescriptorName(unwrapped.command);
	}
};

const commandDescriptorDescription = (node: CommandDescriptorNode): string => {
	const unwrapped = unwrapCommandDescriptorMap(node);
	switch (unwrapped._tag) {
		case "Standard":
		case "GetUserInput":
			return helpDocToText(unwrapped.description);
		case "Subcommands":
			return commandDescriptorDescription(unwrapped.parent);
		case "Map":
			return commandDescriptorDescription(unwrapped.command);
	}
};

const commandDescriptorUsage = (node: CommandDescriptorNode): string => {
	const unwrapped = unwrapCommandDescriptorMap(node);
	const usageNode = unwrapped._tag === "Subcommands" ? unwrapped.parent : unwrapped;
	const usage = Usage.enumerate(
		CommandDescriptor.getUsage(usageNode as unknown as CommandDescriptor.Command<unknown>),
		HELP_CLI_CONFIG,
	)
		.map(spanToText)
		.join(" | ");
	return unwrapped._tag === "Subcommands" ? `${usage} <command>` : usage;
};

const renderHelpCommand = (
	node: CommandDescriptorNode,
	parentPath: readonly string[],
): PithosHelpCommand => {
	const unwrapped = unwrapCommandDescriptorMap(node);
	const name = commandDescriptorName(unwrapped);
	const path = [...parentPath, name];
	const children =
		unwrapped._tag === "Subcommands"
			? unwrapped.children.map((child) => renderHelpCommand(child, path))
			: [];
	return {
		tool: "pithos",
		name,
		path: path.join(" "),
		usage: commandDescriptorUsage(unwrapped),
		description: commandDescriptorDescription(unwrapped),
		subcommands: children,
	};
};

export const renderPithosHelpJson = <Name extends string, R, E, A>(
	command: Command.Command<Name, R, E, A>,
): string => json(renderHelpCommand(command.descriptor as unknown as CommandDescriptorNode, []));

const writeValidationError = (ctx: CliContext, message: string): Effect.Effect<boolean> =>
	ctx.services.output
		.writeError(
			json({
				ok: false,
				error: {
					code: "VALIDATION_ERROR",
					message,
				},
			}),
		)
		.pipe(
			Effect.zipRight(Effect.sync(() => void (process.exitCode = exitCodeFor("VALIDATION_ERROR")))),
			Effect.as(true),
		);

const handleHelpJson = <Name extends string, R, E, A>(
	ctx: CliContext,
	args: readonly string[],
	command: Command.Command<Name, R, E, A>,
): Effect.Effect<boolean> => {
	const cliArgs = args.slice(2);
	if (!cliArgs.includes("--help-json")) return Effect.succeed(false);
	if (cliArgs.length !== 1) {
		return writeValidationError(ctx, "--help-json must be the only pithos argument");
	}
	return ctx.services.output.write(renderPithosHelpJson(command)).pipe(Effect.as(true));
};

const handleCustomHelp = <Name extends string, R, E, A>(
	ctx: CliContext,
	args: readonly string[],
	command: Command.Command<Name, R, E, A>,
): Effect.Effect<boolean> => {
	const help = renderHelp(command, args.slice(2));
	return help === undefined
		? Effect.succeed(false)
		: ctx.services.output.write(help).pipe(Effect.as(true));
};

const handleEmptySearchArg = (ctx: CliContext, args: readonly string[]): Effect.Effect<boolean> => {
	const cliArgs = args.slice(2);
	for (let index = 0; index < cliArgs.length; index += 1) {
		const arg = cliArgs[index];
		if (arg === "--search" && cliArgs[index + 1] === "") {
			return writeValidationError(ctx, "--search must be non-empty");
		}
		if (arg === "--search=") {
			return writeValidationError(ctx, "--search must be non-empty");
		}
	}
	return Effect.succeed(false);
};

const handleTaskReplayReasonArg = (
	ctx: CliContext,
	args: readonly string[],
): Effect.Effect<boolean> => {
	const cliArgs = args.slice(2);
	if (cliArgs[0] !== "task" || cliArgs[1] !== "replay") return Effect.succeed(false);
	if (cliArgs.includes("--help") || cliArgs.includes("-h")) return Effect.succeed(false);
	for (let index = 0; index < cliArgs.length; index += 1) {
		const arg = cliArgs[index];
		if (arg === "--reason") {
			const value = cliArgs[index + 1];
			return value === undefined || value === ""
				? writeValidationError(ctx, "--reason must be non-empty")
				: Effect.succeed(false);
		}
		if (arg === "--reason=") {
			return writeValidationError(ctx, "--reason must be non-empty");
		}
	}
	return writeValidationError(ctx, "missing --reason");
};

const resolveConfig = (config: Config | (() => Config)): Config =>
	typeof config === "function" ? config() : config;

const fromEngine = <A>(thunk: () => A): Effect.Effect<A, PithosError> =>
	Effect.try({
		try: thunk,
		catch: (error) =>
			error instanceof PithosError
				? error
				: new PithosError({
						code: "INTERNAL_ERROR",
						message: error instanceof Error ? error.message : inspect(error),
					}),
	});

const readStdinText = (ctx: CliContext) =>
	Effect.gen(function* () {
		const stdin = yield* ctx.services.input.readStdin();
		switch (stdin._tag) {
			case "NoRedirectedStdin":
				return yield* Effect.fail(
					new PithosError({
						code: "VALIDATION_ERROR",
						message: "--stdin requires redirected stdin",
					}),
				);
			case "ReadFailure":
				return yield* Effect.fail(stdin.error);
			case "RedirectedText":
				if (stdin.text.length === 0) {
					return yield* Effect.fail(
						new PithosError({ code: "VALIDATION_ERROR", message: "stdin body must be non-empty" }),
					);
				}
				return stdin.text;
		}
	});

const readRequiredStdinBody = (ctx: CliContext, command: string, enabled: boolean) =>
	Effect.gen(function* () {
		if (!enabled) {
			return yield* Effect.fail(
				new PithosError({ code: "VALIDATION_ERROR", message: `${command} requires --stdin` }),
			);
		}
		return yield* readStdinText(ctx);
	});

const readOptionalStdinBody = (ctx: CliContext, enabled: boolean) =>
	Effect.gen(function* () {
		if (!enabled) return "";
		return yield* readStdinText(ctx);
	});

const parseResultMetadata = (text: string): string => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch {
		throw new PithosError({
			code: "VALIDATION_ERROR",
			message: "stdin result metadata must be valid JSON object",
		});
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new PithosError({
			code: "VALIDATION_ERROR",
			message: "stdin result metadata must be a JSON object",
		});
	}
	return JSON.stringify(parsed);
};

const readOptionalResultMetadata = (ctx: CliContext, enabled: boolean) =>
	Effect.gen(function* () {
		if (!enabled) return "{}";
		const text = yield* readStdinText(ctx);
		return yield* fromEngine(() => parseResultMetadata(text));
	});

const successGreen = "\u001b[32m";
const warningYellowDim = "\u001b[2m\u001b[33m";
const errorRed = "\u001b[31m";
const ansiReset = "\u001b[0m";
const colorText = (enabled: boolean, code: string, text: string): string =>
	enabled ? `${code}${text}${ansiReset}` : text;

const runCommand = (ctx: CliContext, input: CommandInput) =>
	Effect.gen(function* () {
		const tty = ctx.services.output.isTty();
		const writeJson = (value: unknown) => ctx.services.output.write(json(value));
		const enqueueChain =
			input.command === "task.enqueue"
				? yield* fromEngine(() => parseChainPolicy(input.chain))
				: undefined;
		const graphStatuses =
			input.command === "graph.inspect"
				? yield* fromEngine(() => parseTaskStatuses(input.status))
				: undefined;
		const graphSince = input.command === "graph.inspect" ? input.since : undefined;
		const graphSinceCutoff =
			graphSince === undefined
				? undefined
				: yield* fromEngine(() =>
						parseGraphSinceCutoff(graphSince, Effect.runSync(ctx.services.clock.nowIso())),
					);
		const enqueueBody =
			input.command === "task.enqueue"
				? yield* readRequiredStdinBody(ctx, "task enqueue", input.stdin)
				: undefined;
		const supersedeBody =
			input.command === "task.supersede"
				? yield* readRequiredStdinBody(ctx, "task supersede", input.stdin)
				: undefined;
		const artifactBody =
			input.command === "task.artifact.add"
				? yield* readOptionalStdinBody(ctx, input.stdin)
				: undefined;
		const completeResult =
			input.command === "task.complete"
				? yield* readOptionalResultMetadata(ctx, input.stdin)
				: undefined;
		const config = resolveConfig(ctx.config);
		const engine = makeEngine({ config, services: ctx.services });
		const result = yield* fromEngine(() => {
			switch (input.command) {
				case "init":
					return engine.init({ fresh: input.fresh });
				case "scope.upsert":
					return engine.scopeUpsert({
						kind: input.kind,
						path: input.path,
						parentRepoPath: input.parentRepoPath,
						description: input.description,
					});
				case "scope.list":
					return engine.scopeList({ all: input.all });
				case "scope.archive":
					return engine.scopeArchive({ scopeId: input.scopeId });
				case "run.upsert":
					return engine.runUpsert(input);
				case "run.inspect":
					return engine.runInspect({ runId: input.runId });
				case "run.cleanup":
					return engine.runCleanup(input);
				case "run.interrupt":
					return engine.runInterrupt(input);
				case "run.timeout":
					return engine.runTimeout(input);
				case "events.tail":
					return engine.eventsTail({ limit: input.limit });
				case "task.enqueue":
					return engine.enqueue({
						...input,
						chain: enqueueChain!,
						body: enqueueBody,
						bodyFile: undefined,
					});
				case "task.claim":
					return engine.claim(input);
				case "task.heartbeat":
					return engine.heartbeat(input);
				case "task.complete":
					return engine.complete({ ...input, resultJson: completeResult! });
				case "task.fail":
					return engine.failTask(input);
				case "task.artifact.add":
					return engine.artifactAdd({ ...input, body: artifactBody! });
				case "task.inspect": {
					const inspectOutput = engine.taskInspect({ taskId: input.taskId });
					return input.json ? inspectOutput : renderTaskInspectMarkdown(inspectOutput);
				}
				case "task.cancel":
					return engine.cancel(input);
				case "task.replay":
					return engine.replay(input);
				case "task.supersede":
					return engine.supersede({ ...input, body: supersedeBody, bodyFile: undefined });
				case "graph.inspect": {
					const graphOutput = engine.graphInspect({
						...input,
						status: graphStatuses!,
						sinceCutoff: graphSinceCutoff,
					});
					return input.json
						? graphOutput
						: renderGraphInspectText(graphOutput, { color: tty, homeDir: config.homeDir });
				}
				case "briefing": {
					const briefingOutput = engine.briefing({ agent: input.agent });
					return input.json ? briefingOutput : renderBriefingText(briefingOutput);
				}
			}
		});
		if (typeof result === "string") {
			yield* ctx.services.output.write(result);
		} else if (input.command === "task.claim" && tty) {
			const claimJson = json(result);
			const subtleClaimJson = claimJson.replace(
				'"status":"claimed"',
				`"status":"${colorText(true, successGreen, "claimed")}"`,
			);
			yield* ctx.services.output.write(subtleClaimJson);
		} else {
			yield* writeJson(result);
		}
	}).pipe(
		Effect.catchAll((error) =>
			Effect.gen(function* () {
				const tty = ctx.services.output.isTty();
				const payload = json({ ok: false, error: { code: error.code, message: error.message } });
				const colored =
					error.code === "NO_CLAIMABLE_WORK"
						? colorText(tty, warningYellowDim, payload)
						: colorText(tty, errorRed, payload);
				yield* ctx.services.output.writeError(tty ? colored : payload);
				process.exitCode = exitCodeFor(error.code);
			}),
		),
	);

const textOption = (name: string, pseudoName: string, description: string) =>
	Options.text(name).pipe(Options.withPseudoName(pseudoName), Options.withDescription(description));

const integerOption = (name: string, pseudoName: string, description: string) =>
	Options.integer(name).pipe(
		Options.withPseudoName(pseudoName),
		Options.withDescription(description),
	);

const textArg = (name: string, description: string) =>
	Args.text({ name }).pipe(Args.withDescription(description));

const runIdOption = textOption(
	"run",
	"run-id",
	"Pithos Run id for the agent run making or owning this transition.",
);
const taskIdOption = textOption(
	"task",
	"task-id",
	"Pithos Task id for the held task or graph root.",
);
const reasonOption = textOption(
	"reason",
	"reason",
	"Operator-readable reason recorded in Pithos Events.",
);
const stdinFlag = Options.boolean("stdin").pipe(
	Options.withDescription("Read the command payload from redirected stdin."),
);
const chainOption = textOption(
	"chain",
	"auto|none|held",
	"Task chaining policy: auto, none, or held. Default: auto.",
).pipe(Options.withDefault("auto"));

const parseChainPolicy = (value: string): ChainPolicy => {
	if ((["auto", "none", "held"] as const).includes(value as ChainPolicy)) {
		return value as ChainPolicy;
	}
	throw new PithosError({
		code: "VALIDATION_ERROR",
		message: `Invalid --chain value: '${value}'. Valid values: auto, none, held`,
	});
};

const parseTaskStatuses = (values: readonly string[]): readonly TaskStatus[] =>
	values.map((value) => {
		if (TASK_STATUSES.includes(value as TaskStatus)) return value as TaskStatus;
		throw new PithosError({
			code: "VALIDATION_ERROR",
			message: `Invalid --status value: '${value}'. Valid values: ${TASK_STATUSES.join(", ")}`,
		});
	});

export const makePithosCommand = (ctx: CliContext) => {
	const init = Command.make(
		"init",
		{
			fresh: Options.boolean("fresh").pipe(
				Options.withDescription(
					"Remove any existing Pithos database before creating schema and seed data.",
				),
			),
		},
		({ fresh }) => runCommand(ctx, { command: "init", fresh }),
	).pipe(
		Command.withDescription("Create the Pithos database schema and seed built-in agent kinds."),
	);
	const scopeUpsert = Command.make(
		"upsert",
		{
			kind: Options.choice("kind", ["global", "repo", "worktree"] as const).pipe(
				Options.withDescription("Scope kind: global, repository, or worktree."),
			),
			path: textOption(
				"path",
				"path",
				"Filesystem path for repo/worktree scopes; omit for global scope.",
			).pipe(Options.optional),
			parentRepoPath: textOption(
				"parent-repo",
				"path",
				"Durable parent repo path required for worktree scopes.",
			).pipe(Options.optional),
			description: textOption(
				"description",
				"text",
				"Human-readable description for operator context.",
			).pipe(Options.optional),
		},
		({ kind, path, parentRepoPath, description }) =>
			runCommand(ctx, {
				command: "scope.upsert",
				kind,
				path: opt(path),
				parentRepoPath: opt(parentRepoPath),
				description: opt(description),
			}),
	).pipe(Command.withDescription("Create or update a durable Pithos scope."));
	const scopeList = Command.make(
		"list",
		{
			all: Options.boolean("all").pipe(
				Options.withDescription("Include archived scopes alongside active scopes."),
			),
		},
		({ all }) => runCommand(ctx, { command: "scope.list", all }),
	).pipe(
		Command.withDescription("List durable Pithos scopes with task/run counts and archive state."),
	);
	const scopeArchive = Command.make(
		"archive",
		{ id: textArg("scope-id", "Durable Pithos Scope to archive or delete.") },
		({ id }) => runCommand(ctx, { command: "scope.archive", scopeId: id }),
	).pipe(
		Command.withDescription(
			"Archive one durable Pithos scope, or delete it if nothing has ever referenced it.",
		),
	);
	const scope = Command.make("scope").pipe(
		Command.withDescription("Manage durable Pithos scopes used to partition task queues."),
		Command.withSubcommands([scopeUpsert, scopeList, scopeArchive]),
	);
	const runUpsert = Command.make(
		"upsert",
		{
			agent: textOption(
				"agent",
				"agent-kind",
				"Agent kind for this Run, for example pandora, toil, greed, or war.",
			),
			mode: Options.choice("mode", ["afk", "hitl"] as const).pipe(
				Options.withDescription("Supervision mode: AFK process or HITL tmux session."),
			),
			scope: textOption("scope", "scope-id", "Pithos Scope id this Run belongs to."),
			cwd: textOption("cwd", "path", "Working directory the Harness should run in."),
			harnessKind: Options.choice("harness-kind", ["claude", "pi", "system"] as const).pipe(
				Options.withDescription("Underlying harness runtime used by the agent run."),
			),
			sessionLogPath: textOption(
				"session-log-path",
				"path",
				"JSONL Harness session log path for agent-facing observability.",
			),
			sessionId: textOption(
				"session-id",
				"session-id",
				"Harness session id assigned by the launcher.",
			),
			runId: runIdOption.pipe(Options.optional),
		},
		(o) =>
			runCommand(ctx, {
				command: "run.upsert",
				agent: o.agent,
				mode: o.mode,
				scope: o.scope,
				cwd: o.cwd,
				harnessKind: o.harnessKind,
				sessionLogPath: o.sessionLogPath,
				sessionId: o.sessionId,
				runId: opt(o.runId),
			}),
	).pipe(Command.withDescription("Create or update the durable run row for one agent invocation."));
	const runInspect = Command.make(
		"inspect",
		{ id: textArg("run-id", "Durable Pithos Run to inspect.") },
		({ id }) => runCommand(ctx, { command: "run.inspect", runId: id }),
	).pipe(Command.withDescription("Show one durable Pithos run record."));
	const runCleanup = Command.make(
		"cleanup",
		{ runId: runIdOption, reason: reasonOption },
		({ runId, reason }) => runCommand(ctx, { command: "run.cleanup", runId, reason }),
	).pipe(
		Command.withDescription(
			"Mark a naturally ended agent run as cleaned up and release any held task.",
		),
	);
	const runInterrupt = Command.make(
		"interrupt",
		{
			runId: runIdOption.pipe(Options.optional),
			taskId: taskIdOption.pipe(Options.optional),
			reason: reasonOption,
		},
		(o) =>
			runCommand(ctx, {
				command: "run.interrupt",
				runId: opt(o.runId),
				taskId: opt(o.taskId),
				reason: o.reason,
			}),
	).pipe(
		Command.withDescription("Deliberately interrupt a live run and fail its held task if present."),
	);
	const runTimeout = Command.make(
		"timeout",
		{ runId: runIdOption, reason: reasonOption },
		({ runId, reason }) => runCommand(ctx, { command: "run.timeout", runId, reason }),
	).pipe(Command.withDescription("Mark a non-Pandora no-claim session as timed out."));
	const runParent = Command.make("run").pipe(
		Command.withDescription("Manage durable Pithos run records for agent invocations."),
		Command.withSubcommands([runUpsert, runInspect, runCleanup, runInterrupt, runTimeout]),
	);
	const eventsTail = Command.make(
		"tail",
		{
			limit: integerOption(
				"limit",
				"count",
				"Maximum number of newest Pithos Events to print.",
			).pipe(Options.optional),
		},
		({ limit }) => runCommand(ctx, { command: "events.tail", limit: opt(limit) }),
	).pipe(Command.withDescription("Print newest durable Pithos events."));
	const events = Command.make("events").pipe(
		Command.withDescription("Inspect durable Pithos event history."),
		Command.withSubcommands([eventsTail]),
	);
	const capabilityChoices = BUILTIN_CAPABILITIES.join(", ");
	const capability = Options.choice("capability", BUILTIN_CAPABILITIES).pipe(
		Options.withDescription(`Task capability used for claim authorization: ${capabilityChoices}.`),
	);
	const taskEnqueue = Command.make(
		"enqueue",
		{
			scope: textOption("scope", "scope-id", "Pithos Scope id where the Task will be queued."),
			capability,
			title: textOption("title", "title", "Short Task title shown in graph and inspection output."),
			stdin: stdinFlag,
			runId: runIdOption.pipe(Options.optional),
			after: textOption(
				"after",
				"task-id",
				"Upstream Task id that must be done before this Task is claimable.",
			).pipe(Options.repeated, Options.optional),
			about: textOption(
				"about",
				"task-id",
				"Singular branch-attention Task id this Task is about.",
			).pipe(Options.optional),
			gate: textOption(
				"gate-on",
				"task-id",
				"Target Task id whose canonical branch closure must drain before this Task is claimable.",
			).pipe(Options.repeated, Options.optional),
			repair: textOption("repair", "task-id", "System-only Repair Alert target Task id.").pipe(
				Options.optional,
			),
			chain: chainOption,
		},
		(o) =>
			runCommand(ctx, {
				command: "task.enqueue",
				scope: o.scope,
				capability: o.capability,
				title: o.title,
				stdin: o.stdin,
				runId: opt(o.runId),
				after: opt(o.after) ?? [],
				gate: opt(o.gate) ?? [],
				about: opt(o.about),
				repair: opt(o.repair),
				chain: o.chain,
			}),
	).pipe(
		Command.withDescription(
			"Queue a durable task with typed edges; --chain auto preserves held-task chains.",
		),
	);
	const taskClaim = Command.make(
		"claim",
		{
			runId: runIdOption.pipe(Options.optional),
			scope: textOption("scope", "scope-id", "Pithos Scope id to claim from."),
			capability,
		},
		(o) =>
			runCommand(ctx, {
				command: "task.claim",
				runId: opt(o.runId),
				scope: o.scope,
				capability: o.capability,
			}),
	).pipe(
		Command.withDescription("Claim one claimable task for a run and return its fencing token."),
	);
	const taskHeartbeat = Command.make(
		"heartbeat",
		{
			runId: runIdOption.pipe(Options.optional),
			taskId: taskIdOption.pipe(Options.optional),
			token: integerOption("token", "token", "Current fencing token for the held Task.").pipe(
				Options.optional,
			),
		},
		(o) =>
			runCommand(ctx, {
				command: "task.heartbeat",
				runId: opt(o.runId),
				taskId: opt(o.taskId),
				token: opt(o.token),
			}),
	).pipe(Command.withDescription("Record liveness for a held task claim."));
	const taskComplete = Command.make(
		"complete",
		{
			taskId: textArg("task-id", "Held Task to complete."),
			runId: runIdOption.pipe(Options.optional),
			token: integerOption(
				"token",
				"token",
				"Current fencing token proving ownership of the held Task.",
			),
			stdin: stdinFlag,
		},
		(o) =>
			runCommand(ctx, {
				command: "task.complete",
				taskId: o.taskId,
				runId: opt(o.runId),
				token: o.token,
				stdin: o.stdin,
			}),
	).pipe(Command.withDescription("Complete a held task using its current fencing token."));
	const taskFail = Command.make(
		"fail",
		{
			taskId: textArg("task-id", "Held Task to fail."),
			runId: runIdOption.pipe(Options.optional),
			token: integerOption(
				"token",
				"token",
				"Current fencing token proving ownership of the held Task.",
			),
			reason: reasonOption,
		},
		(o) =>
			runCommand(ctx, {
				command: "task.fail",
				taskId: o.taskId,
				runId: opt(o.runId),
				token: o.token,
				reason: o.reason,
			}),
	).pipe(Command.withDescription("Fail a held task using its current fencing token."));
	const artifactAdd = Command.make(
		"add",
		{
			taskId: textArg("task-id", "Held Task receiving the artifact."),
			runId: runIdOption.pipe(Options.optional),
			token: integerOption(
				"token",
				"token",
				"Current fencing token proving ownership of the held Task.",
			),
			kind: textOption("kind", "kind", "Lower-snake-case artifact kind."),
			title: textOption("title", "title", "Short artifact title shown with the Task."),
			stdin: stdinFlag,
		},
		(o) =>
			runCommand(ctx, {
				command: "task.artifact.add",
				taskId: o.taskId,
				runId: opt(o.runId),
				token: o.token,
				kind: o.kind,
				title: o.title,
				stdin: o.stdin,
			}),
	).pipe(
		Command.withDescription(
			"Attach an artifact to a held task using its current fencing token; optional body is read from stdin when requested.",
		),
	);
	const taskArtifact = Command.make("artifact").pipe(
		Command.withDescription("Attach evidence or output to a Pithos task."),
		Command.withSubcommands([artifactAdd]),
	);
	const taskInspect = Command.make(
		"inspect",
		{
			taskId: textArg("task-id", "Task to inspect."),
			json: Options.boolean("json").pipe(
				Options.withDescription("Return the full structured inspect object as JSON."),
			),
		},
		(o) => runCommand(ctx, { command: "task.inspect", taskId: o.taskId, json: o.json }),
	).pipe(
		Command.withDescription("Show a single-task dossier; pass --json for structured metadata."),
	);
	const taskCancel = Command.make(
		"cancel",
		{
			taskId: textArg("task-id", "Non-held Task to cancel."),
			runId: runIdOption.pipe(Options.optional),
			reason: reasonOption,
		},
		(o) =>
			runCommand(ctx, {
				command: "task.cancel",
				taskId: o.taskId,
				runId: opt(o.runId),
				reason: o.reason,
			}),
	).pipe(Command.withDescription("Cancel non-held work that should not continue."));
	const taskReplay = Command.make(
		"replay",
		{
			taskId: textArg("target-task-id", "Broken target Task to replay."),
			runId: runIdOption.pipe(Options.optional),
			token: integerOption("token", "token", "Current fencing token for the held Repair Alert."),
			reason: reasonOption,
		},
		(o) =>
			runCommand(ctx, {
				command: "task.replay",
				taskId: o.taskId,
				runId: opt(o.runId),
				token: o.token,
				reason: o.reason,
			}),
	).pipe(
		Command.withDescription(
			"Replay a broken target task through the held Pandora Repair Alert and complete that alert.",
		),
	);
	const taskSupersede = Command.make(
		"supersede",
		{
			taskId: textArg("task-id", "Task to replace with a fresh successor."),
			runId: runIdOption.pipe(Options.optional),
			reason: reasonOption,
			title: textOption(
				"title",
				"title",
				"Replacement Task title; defaults to the superseded Task title.",
			).pipe(Options.optional),
			stdin: stdinFlag,
			scope: textOption(
				"scope",
				"scope-id",
				"Replacement Task Scope; defaults to the superseded Task Scope.",
			).pipe(Options.optional),
			capability: capability.pipe(Options.optional),
		},
		(o) =>
			runCommand(ctx, {
				command: "task.supersede",
				taskId: o.taskId,
				runId: opt(o.runId),
				reason: o.reason,
				title: opt(o.title),
				stdin: o.stdin,
				scope: opt(o.scope),
				capability: opt(o.capability),
			}),
	).pipe(
		Command.withDescription(
			"Replace a task with a fresh successor while preserving supersession history.",
		),
	);
	const task = Command.make("task").pipe(
		Command.withDescription("Manage durable Pithos tasks, claims, fencing, and supersession."),
		Command.withSubcommands([
			taskEnqueue,
			taskClaim,
			taskHeartbeat,
			taskComplete,
			taskFail,
			taskInspect,
			taskCancel,
			taskReplay,
			taskSupersede,
			taskArtifact,
		]),
	);
	const graphInspect = Command.make(
		"inspect",
		{
			taskId: taskIdOption.pipe(Options.optional),
			scope: textOption("scope", "scope-id", "Restrict graph output to one Pithos Scope.").pipe(
				Options.optional,
			),
			all: Options.boolean("all").pipe(
				Options.withDescription(
					"Inspect the global graph selection, excluding stale cancelled tasks unless needed for closure.",
				),
			),
			status: textOption(
				"status",
				"status",
				"Seed from Tasks with this exact status; repeated values are ORed. Valid values: queued, claimed, running, done, failed, dead_letter, cancelled.",
			).pipe(Options.repeated, Options.optional),
			search: textOption(
				"search",
				"text",
				"Seed from Tasks whose title or body contains this case-insensitive text; repeated values are ANDed.",
			).pipe(Options.repeated, Options.optional),
			since: textOption(
				"since",
				"cutoff",
				"Seed from Tasks touched at or after cutoff: today, <n>h, <n>d, YYYY-MM-DD, or ISO timestamp with timezone.",
			).pipe(Options.optional),
			json: Options.boolean("json").pipe(
				Options.withDescription("Return the full structured graph object as JSON."),
			),
		},
		(o) =>
			runCommand(ctx, {
				command: "graph.inspect",
				taskId: opt(o.taskId),
				scope: opt(o.scope),
				all: o.all,
				status: opt(o.status) ?? [],
				search: opt(o.search) ?? [],
				since: opt(o.since),
				json: o.json,
			}),
	).pipe(
		Command.withDescription(
			"Render a readable task graph with typed edges, gates, and supersessions; pass --json for structured metadata.",
		),
	);
	const graph = Command.make("graph").pipe(
		Command.withDescription("Inspect Pithos task typed-edge and supersession graphs."),
		Command.withSubcommands([graphInspect]),
	);
	const briefing = Command.make(
		"briefing",
		{
			agent: textOption("agent", "agent-kind", "Agent kind to tailor the briefing for.").pipe(
				Options.optional,
			),
			json: Options.boolean("json").pipe(
				Options.withDescription("Return ready and blocked task arrays as JSON."),
			),
		},
		(o) => runCommand(ctx, { command: "briefing", agent: opt(o.agent), json: o.json }),
	).pipe(
		Command.withDescription(
			"Print a readable ready/blocked briefing; pass --json for structured task arrays.",
		),
	);
	return Command.make("pithos").pipe(
		Command.withDescription(
			"Durable state CLI for tasks, runs, claims, artifacts, events, and graph invariants.",
		),
		Command.withSubcommands([init, scope, runParent, task, graph, events, briefing]),
	);
};

export const runPithosCli = (ctx: CliContext, args: readonly string[]) => {
	const command = makePithosCommand(ctx);
	return Effect.gen(function* () {
		const handledHelpJson = yield* handleHelpJson(ctx, args, command);
		if (handledHelpJson) return;
		const handledCustomHelp = yield* handleCustomHelp(ctx, args, command);
		if (handledCustomHelp) return;
		const handledEmptySearchArg = yield* handleEmptySearchArg(ctx, args);
		if (handledEmptySearchArg) return;
		const handledTaskReplayReasonArg = yield* handleTaskReplayReasonArg(ctx, args);
		if (handledTaskReplayReasonArg) return;
		const cli = Command.run(command, { name: "Pithos", version: "0.1.0", executable: "pithos" });
		yield* cli(args);
	}).pipe(
		Effect.provide(Layer.mergeAll(NodeContext.layer, CliConfig.layer({ showBuiltIns: false }))),
	);
};
