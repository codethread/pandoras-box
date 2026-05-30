import { CliConfig, CommandDescriptor, HelpDoc, Usage, type Command, type Span } from "@effect/cli";

type DescriptorNode =
	| {
			readonly _tag: "Standard" | "GetUserInput";
			readonly name: string;
			readonly description: HelpDoc.HelpDoc;
	  }
	| { readonly _tag: "Map"; readonly command: DescriptorNode }
	| {
			readonly _tag: "Subcommands";
			readonly parent: DescriptorNode;
			readonly children: readonly DescriptorNode[];
	  };

type LeafDescriptor = Extract<DescriptorNode, { readonly _tag: "Standard" | "GetUserInput" }>;

interface ResolvedCommand {
	readonly descriptor: DescriptorNode;
	readonly path: readonly string[];
}

const helpConfig = CliConfig.make({ showBuiltIns: false });

const unwrap = (node: DescriptorNode): DescriptorNode =>
	node._tag === "Map" ? unwrap(node.command) : node;

const descriptorName = (node: DescriptorNode): string => {
	const unwrapped = unwrap(node);
	switch (unwrapped._tag) {
		case "Standard":
		case "GetUserInput":
			return unwrapped.name;
		case "Subcommands":
			return descriptorName(unwrapped.parent);
		case "Map":
			return descriptorName(unwrapped.command);
	}
};

const descriptorChildren = (node: DescriptorNode): readonly DescriptorNode[] => {
	const unwrapped = unwrap(node);
	return unwrapped._tag === "Subcommands" ? unwrapped.children : [];
};

const descriptorLeaf = (node: DescriptorNode): LeafDescriptor => {
	const unwrapped = unwrap(node);
	switch (unwrapped._tag) {
		case "Standard":
		case "GetUserInput":
			return unwrapped;
		case "Subcommands":
			return descriptorLeaf(unwrapped.parent);
		case "Map":
			return descriptorLeaf(unwrapped.command);
	}
};

const resolveCommand = (
	descriptor: CommandDescriptor.Command<unknown>,
	positional: readonly string[],
): ResolvedCommand => {
	const root = descriptor as unknown as DescriptorNode;
	const walk = (
		node: DescriptorNode,
		remaining: readonly string[],
		path: readonly string[],
	): ResolvedCommand => {
		const child = descriptorChildren(node).find(
			(candidate) => descriptorName(candidate) === remaining[0],
		);
		return child === undefined
			? { descriptor: node, path }
			: walk(child, remaining.slice(1), [...path, descriptorName(child)]);
	};
	return walk(root, positional, [descriptorName(root)]);
};

const spanToText = (span: Span.Span): string => {
	switch (span._tag) {
		case "Text":
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

const cleanDescription = (text: string): string => {
	const trimmed = text.trim();
	if (
		trimmed === "This setting is optional." ||
		trimmed === "This option may be repeated zero or more times." ||
		trimmed === "This argument may be repeated zero or more times."
	) {
		return "";
	}
	const defaultMatch = /^This setting is optional\. Defaults to: (.+)$/u.exec(trimmed);
	if (defaultMatch !== null) return `Default: ${defaultMatch[1]}.`;
	return trimmed;
};

const isPrimitiveHelp = (text: string): boolean =>
	text === "A user-defined piece of text." ||
	text === "A true or false value." ||
	text === "An integer." ||
	text === "A floating point value." ||
	text.startsWith("One of the following:");

const flattenParagraphs = (doc: HelpDoc.HelpDoc): readonly string[] => {
	switch (doc._tag) {
		case "Empty":
			return [];
		case "Header":
			return [];
		case "Paragraph":
			return [cleanDescription(spanToText(doc.value))].filter((line) => line.length > 0);
		case "DescriptionList":
			return doc.definitions.flatMap(([, definition]) => flattenParagraphs(definition));
		case "Enumeration":
			return doc.elements.flatMap(flattenParagraphs);
		case "Sequence":
			return [...flattenParagraphs(doc.left), ...flattenParagraphs(doc.right)];
	}
};

const flattenDefinitionParagraphs = (doc: HelpDoc.HelpDoc): readonly string[] => {
	const paragraphs = flattenParagraphs(doc);
	return isPrimitiveHelp(paragraphs[0] ?? "") ? paragraphs.slice(1) : paragraphs;
};

const collectDescriptionLists = (
	doc: HelpDoc.HelpDoc,
	currentHeader: string | undefined = undefined,
): ReadonlyMap<string, readonly [string, string][]> => {
	const entries = new Map<string, [string, string][]>();
	const add = (header: string, pair: [string, string]) => {
		const existing = entries.get(header) ?? [];
		entries.set(header, [...existing, pair]);
	};
	const visit = (node: HelpDoc.HelpDoc, header: string | undefined): void => {
		switch (node._tag) {
			case "Empty":
			case "Paragraph":
				return;
			case "Header":
				return;
			case "DescriptionList":
				for (const [term, definition] of node.definitions) {
					add(header ?? "Details", [
						spanToText(term).trim(),
						flattenDefinitionParagraphs(definition).join(" "),
					]);
				}
				return;
			case "Enumeration":
				for (const element of node.elements) visit(element, header);
				return;
			case "Sequence": {
				const leftHeader =
					node.left._tag === "Header" ? spanToText(node.left.value).trim() : header;
				visit(node.left, header);
				visit(node.right, leftHeader);
			}
		}
	};
	visit(doc, currentHeader);
	return entries;
};

const renderPairs = (title: string, pairs: readonly [string, string][]): readonly string[] => {
	if (pairs.length === 0) return [];
	const width = Math.min(30, Math.max(...pairs.map(([left]) => left.length), title.length) + 2);
	return [
		`${title}:`,
		...pairs.map(([left, right]) =>
			left.length >= width
				? `  ${left}\n    ${right}`.trimEnd()
				: `  ${left.padEnd(width)}${right}`.trimEnd(),
		),
	];
};

const usageText = (descriptor: DescriptorNode, path: readonly string[]): string => {
	const usage = HelpDoc.toAnsiText(
		Usage.getHelp(
			CommandDescriptor.getUsage(descriptor as unknown as CommandDescriptor.Command<unknown>),
		),
	)
		.trim()
		.replace(/\s+/gu, " ");
	const command = path.at(-1);
	const hasChildren = descriptorChildren(descriptor).length > 0;
	const suffix =
		command === undefined || usage === "" || usage === command
			? hasChildren
				? "<command>"
				: ""
			: usage.startsWith(`${command} `)
				? usage.slice(command.length + 1)
				: usage;
	return suffix.length === 0 ? path.join(" ") : `${path.join(" ")} ${suffix}`;
};

const renderResolvedHelp = (resolved: ResolvedCommand): string => {
	const help = CommandDescriptor.getHelp(
		resolved.descriptor as unknown as CommandDescriptor.Command<unknown>,
		helpConfig,
	);
	const description = flattenParagraphs(descriptorLeaf(resolved.descriptor).description);
	const descriptionLists = collectDescriptionLists(help);
	const commands = descriptorChildren(resolved.descriptor).map((child): [string, string] => [
		descriptorName(child),
		flattenParagraphs(descriptorLeaf(child).description).join(" "),
	]);
	const args = descriptionLists.get("ARGUMENTS") ?? [];
	const options = descriptionLists.get("OPTIONS") ?? [];
	return [
		resolved.path.join(" "),
		"",
		...description,
		"",
		"Usage:",
		`  ${usageText(resolved.descriptor, resolved.path)}`,
		"",
		...renderPairs("Commands", commands),
		...(commands.length === 0 ? [] : [""]),
		...renderPairs("Arguments", args),
		...(args.length === 0 ? [] : [""]),
		...renderPairs("Options", options),
		...(options.length === 0 ? [] : [""]),
	]
		.join("\n")
		.replace(/\n+$/u, "\n");
};

export const renderHelp = <Name extends string, R, E, A>(
	command: Command.Command<Name, R, E, A>,
	args: readonly string[],
): string | undefined => {
	const positional = args.filter((arg) => !arg.startsWith("-"));
	if (positional[0] === "help") {
		return renderResolvedHelp(resolveCommand(command.descriptor, positional.slice(1)));
	}
	if (args.includes("--help") || args.includes("-h")) {
		return renderResolvedHelp(resolveCommand(command.descriptor, positional));
	}
	return undefined;
};
