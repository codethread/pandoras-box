import {
	BUILTIN_AGENT_CLAIMS,
	BUILTIN_CAPABILITIES,
	BUILTIN_SPAWNABLE_AGENT_KINDS,
} from "@pdx/pithos/builtins";
import { Command, Options } from "@effect/cli";
import { Effect, Option, ParseResult, Schema } from "effect";
import { SpawnerError } from "./errors.js";
import { renderHelp } from "./help.js";
import { AgentKindSchema, ModeSchema } from "./spawner.js";

const CapabilitySchema = Schema.Literal(...BUILTIN_CAPABILITIES);

const PreviewInputRawSchema = Schema.Struct({
	agent: AgentKindSchema,
	mode: ModeSchema,
	runId: Schema.NonEmptyString,
	sessionId: Schema.NonEmptyString,
	scopeId: Schema.NonEmptyString,
	scopeKind: Schema.optional(Schema.Literal("global", "repo", "worktree")),
	scopePath: Schema.optional(Schema.NonEmptyString),
	cwd: Schema.NonEmptyString,
	parentRepoPath: Schema.optional(Schema.NonEmptyString),
	selectedCapability: Schema.optional(CapabilitySchema),
});

type PreviewInputRaw = Schema.Schema.Type<typeof PreviewInputRawSchema>;

export type PreviewInput = PreviewInputRaw;

const opt = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value);

const decode = <A, I>(
	schema: Schema.Schema<A, I>,
	value: unknown,
): Effect.Effect<A, SpawnerError> =>
	Schema.decodeUnknown(schema)(value).pipe(
		Effect.mapError(
			(error) =>
				new SpawnerError({
					code: "VALIDATION_ERROR",
					message: `invalid preview invocation\n${ParseResult.TreeFormatter.formatErrorSync(error)}`,
				}),
		),
	);

const invalidPreview = (message: string): SpawnerError =>
	new SpawnerError({ code: "VALIDATION_ERROR", message: `invalid preview invocation\n${message}` });

const parsePreviewInput = (raw: PreviewInputRaw): Effect.Effect<PreviewInput, SpawnerError> =>
	decode(PreviewInputRawSchema, raw).pipe(
		Effect.flatMap((input): Effect.Effect<PreviewInput, SpawnerError> => {
			const base = {
				mode: input.mode,
				runId: input.runId,
				sessionId: input.sessionId,
				scopeId: input.scopeId,
				...(input.scopeKind === undefined ? {} : { scopeKind: input.scopeKind }),
				...(input.scopePath === undefined ? {} : { scopePath: input.scopePath }),
				cwd: input.cwd,
				...(input.parentRepoPath === undefined ? {} : { parentRepoPath: input.parentRepoPath }),
			} as const;
			const claims = BUILTIN_AGENT_CLAIMS[input.agent];
			if (claims.length === 1 && input.selectedCapability !== undefined) {
				return Effect.fail(
					invalidPreview(`${input.agent} preview must not set --selected-capability`),
				);
			}
			if (claims.length > 1 && input.selectedCapability !== undefined) {
				if (!(claims as readonly string[]).includes(input.selectedCapability)) {
					return Effect.fail(
						invalidPreview(
							`${input.agent} preview selected capability ${input.selectedCapability} is not authorized`,
						),
					);
				}
			}
			return Effect.succeed<PreviewInput>({
				...base,
				agent: input.agent,
				selectedCapability: input.selectedCapability,
			});
		}),
	);

const textOption = (name: string, pseudoName: string, description: string) =>
	Options.text(name).pipe(Options.withPseudoName(pseudoName), Options.withDescription(description));

export const makeSpawnerCommand = (
	executePreview: (input: PreviewInput) => Effect.Effect<void, SpawnerError>,
) => {
	const previewCommand = Command.make(
		"preview",
		{
			agent: Options.choice("agent", BUILTIN_SPAWNABLE_AGENT_KINDS).pipe(
				Options.withDescription("Agent kind to render: pandora, toil, greed, war, or envy."),
			),
			mode: Options.choice("mode", ["afk", "hitl"] as const).pipe(
				Options.withDescription("Launch mode; must match manifest."),
			),
			scopeId: textOption("scope", "scope-id", "Pithos Scope id for the rendered Agent run.").pipe(
				Options.withSchema(Schema.NonEmptyString),
			),
			runId: textOption("run", "run-id", "Caller-supplied Pithos Run id.").pipe(
				Options.withSchema(Schema.NonEmptyString),
			),
			sessionId: textOption("session-id", "session-id", "Caller-supplied Harness session id.").pipe(
				Options.withSchema(Schema.NonEmptyString),
			),
			cwd: textOption("cwd", "path", "Working directory for the Harness.").pipe(
				Options.withSchema(Schema.NonEmptyString),
			),
			scopeKind: Options.choice("scope-kind", ["global", "repo", "worktree"] as const).pipe(
				Options.withDescription("Durable Pithos Scope kind for policy rule preview matching."),
				Options.optional,
			),
			scopePath: textOption(
				"scope-path",
				"path",
				"Recorded repo/worktree Scope path for policy rule preview matching.",
			).pipe(Options.optional),
			parentRepoPath: textOption(
				"parent-repo",
				"path",
				"Durable parent repo root for worktree scope previews.",
			).pipe(Options.optional),
			selectedCapability: Options.choice("selected-capability", BUILTIN_CAPABILITIES).pipe(
				Options.withDescription(
					"Current Capability for multi-claim agents; omit to render all claimable Capability guidance.",
				),
				Options.optional,
			),
		},
		({
			agent,
			mode,
			scopeId,
			scopeKind,
			scopePath,
			runId,
			sessionId,
			cwd,
			parentRepoPath,
			selectedCapability,
		}) =>
			parsePreviewInput({
				agent,
				mode,
				scopeId,
				...(opt(scopeKind) === undefined ? {} : { scopeKind: opt(scopeKind) }),
				...(opt(scopePath) === undefined ? {} : { scopePath: opt(scopePath) }),
				runId,
				sessionId,
				cwd,
				...(opt(parentRepoPath) === undefined ? {} : { parentRepoPath: opt(parentRepoPath) }),
				...(opt(selectedCapability) === undefined
					? {}
					: { selectedCapability: opt(selectedCapability) }),
			}).pipe(Effect.flatMap(executePreview)),
	).pipe(
		Command.withDescription(
			"Render an agent prompt and harness launch description without touching Pithos state.",
		),
	);

	return Command.make("pandora-spawn").pipe(
		Command.withDescription(
			"Harness prompt renderer for Pandora's Box agent runs. Launch, kill, and supervision are owned by pdx.",
		),
		Command.withSubcommands([previewCommand]),
	);
};

export const renderSpawnerCustomHelp = <Name extends string, R, E, A>(
	command: Command.Command<Name, R, E, A>,
	args: readonly string[],
): string | undefined => renderHelp(command, args);
