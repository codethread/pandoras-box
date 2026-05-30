import { Args, Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { renderHelp } from "./index.js";

const inspectCommand = Command.make(
	"inspect",
	{
		id: Args.text({ name: "item-id" }).pipe(Args.withDescription("Item to inspect.")),
		json: Options.boolean("json").pipe(Options.withDescription("Return structured JSON.")),
		dataDir: Options.text("data-dir").pipe(
			Options.withPseudoName("path"),
			Options.optional,
			Options.withDescription("Directory containing demo state."),
		),
		limit: Options.integer("limit").pipe(
			Options.withPseudoName("count"),
			Options.optional,
			Options.withDescription("Maximum records to show."),
		),
		workers: Options.integer("workers").pipe(
			Options.withPseudoName("count"),
			Options.withDescription("Worker count. Default: 4."),
			Options.withDefault(4),
		),
		mode: Options.choice("mode", ["short", "full"] as const).pipe(
			Options.withDescription("Inspection detail level."),
		),
		tag: Options.text("tag").pipe(
			Options.withPseudoName("tag"),
			Options.withDescription("Filter by tag; repeated values are ORed."),
			Options.repeated,
			Options.optional,
		),
		literal: Options.text("literal").pipe(
			Options.withDescription("One of the following: keep this authored sentence."),
			Options.optional,
		),
	},
	() => Effect.void,
).pipe(Command.withDescription("Inspect one item."));

const command = Command.make("demo").pipe(
	Command.withDescription("Demo command tree."),
	Command.withSubcommands([
		Command.make("item").pipe(
			Command.withDescription("Manage demo items."),
			Command.withSubcommands([inspectCommand]),
		),
		Command.make("status", {}, () => Effect.void).pipe(
			Command.withDescription("Show demo status."),
		),
	]),
);

const rendered = (args: readonly string[]): string => {
	const help = renderHelp(command, args);
	if (help === undefined) throw new Error(`expected help for args: ${args.join(" ")}`);
	return help;
};

describe("renderHelp", () => {
	it("renders root help from the Effect command descriptor", () => {
		expect(rendered(["--help"])).toMatchSnapshot();
	});

	it("renders nested parent help from the Effect command descriptor", () => {
		expect(rendered(["item", "--help"])).toMatchSnapshot();
	});

	it("renders leaf help from args, options, pseudo names, choices, repeats, defaults, and descriptions", () => {
		expect(rendered(["item", "inspect", "--help"])).toMatchSnapshot();
	});

	it.each([
		["short help flag", ["-h"]],
		["help command", ["help"]],
		["nested help command", ["help", "item", "inspect"]],
		["leaf short help flag", ["item", "inspect", "-h"]],
		["leaf help with positional value", ["item", "inspect", "item_123", "--help"]],
	] as const)("resolves %s", (_name, args) => {
		expect(rendered(args)).toMatchSnapshot();
	});

	it("returns undefined when no help was requested", () => {
		expect(renderHelp(command, ["item", "inspect", "item_123"])).toBeUndefined();
	});
});
