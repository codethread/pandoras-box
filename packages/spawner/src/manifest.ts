import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { BUILTIN_SPAWNABLE_AGENT_KINDS, type SpawnableAgentKind } from "@pdx/pithos/builtins";
import { Either, ParseResult, Schema } from "effect";
import * as Toml from "@iarna/toml";
import { SpawnerError } from "./errors.js";
import {
	bundledDataDirResourcesDir,
	resolveAgentsPath,
	resolveTemplatesDir,
	resolveUserDataDir,
	type ScopeKind,
} from "./paths.js";
import type { RenderAgentInput } from "./spawner.js";
import type { RenderServices } from "./services.js";

const HarnessKindSchema = Schema.Literal("claude", "pi");
const SystemPromptModeSchema = Schema.Literal("replace", "append");
const NonEmptyStringArray = Schema.Array(Schema.NonEmptyString);

const ListOpsSchema = Schema.Struct({
	replace: Schema.optional(NonEmptyStringArray),
	remove: Schema.optional(NonEmptyStringArray),
	add: Schema.optional(NonEmptyStringArray),
});
const PolicyListOpsSchema = Schema.Struct({
	replace: Schema.optional(NonEmptyStringArray),
	remove: Schema.optional(NonEmptyStringArray),
	add: Schema.optional(NonEmptyStringArray),
});
const PolicyDeclarationSchema = Schema.Struct({
	file: Schema.NonEmptyString,
});
const ArgvListOpsSchema = Schema.Struct({
	replace: Schema.optional(NonEmptyStringArray),
	add: Schema.optional(NonEmptyStringArray),
});
const ScalarBooleanSchema = Schema.Boolean;
const HookCommandSchema = Schema.Array(Schema.NonEmptyString).pipe(Schema.minItems(1));

const PartialHarnessSchema = Schema.Struct({
	kind: Schema.optional(HarnessKindSchema),
	model: Schema.optional(Schema.NonEmptyString),
	system_prompt_mode: Schema.optional(SystemPromptModeSchema),
	tools: Schema.optional(ListOpsSchema),
	argv: Schema.optional(ArgvListOpsSchema),
});

const PartialAgentSchema = Schema.Struct({
	template: Schema.optional(Schema.NonEmptyString),
	includes: Schema.optional(ListOpsSchema),
	appends: Schema.optional(ListOpsSchema),
	policy: Schema.optional(PolicyListOpsSchema),
	harness: Schema.optional(PartialHarnessSchema),
});

const PartialHooksSchema = Schema.Struct({
	input: Schema.optional(
		Schema.Struct({
			enabled: Schema.optional(ScalarBooleanSchema),
			command: Schema.optional(HookCommandSchema),
		}),
	),
});

const PartialAgentsTableSchema = Schema.Struct({
	pandora: Schema.optional(PartialAgentSchema),
	toil: Schema.optional(PartialAgentSchema),
	greed: Schema.optional(PartialAgentSchema),
	war: Schema.optional(PartialAgentSchema),
	envy: Schema.optional(PartialAgentSchema),
});

const PolicyRuleSchema = Schema.Struct({
	path: Schema.optional(Schema.NonEmptyString),
	path_glob: Schema.optional(Schema.NonEmptyString),
	scope_kind: Schema.optional(Schema.Literal("global", "repo", "worktree")),
	agent: Schema.optional(Schema.Literal(...BUILTIN_SPAWNABLE_AGENT_KINDS)),
	policy: Schema.optional(PolicyListOpsSchema),
	agents: Schema.optional(PartialAgentsTableSchema),
});

const PartialAgentsFileSchema = Schema.Struct({
	policies: Schema.optional(Schema.Record({ key: Schema.String, value: PolicyDeclarationSchema })),
	policy: Schema.optional(PolicyListOpsSchema),
	agents: Schema.optional(PartialAgentsTableSchema),
	hooks: Schema.optional(PartialHooksSchema),
	rules: Schema.optional(Schema.Array(PolicyRuleSchema)),
});

const ResolvedHarnessSchema = Schema.Struct({
	kind: HarnessKindSchema,
	model: Schema.NonEmptyString,
	system_prompt_mode: SystemPromptModeSchema,
	tools: Schema.optional(NonEmptyStringArray),
	argv: Schema.optionalWith(Schema.Array(Schema.NonEmptyString), { default: () => [] }),
});

const ResolvedAgentSchema = Schema.Struct({
	template: Schema.NonEmptyString,
	includes: Schema.optionalWith(NonEmptyStringArray, { default: () => [] }),
	appends: Schema.optionalWith(NonEmptyStringArray, { default: () => [] }),
	harness: ResolvedHarnessSchema,
});

const ResolvedHooksSchema = Schema.Struct({
	input: Schema.optional(
		Schema.Struct({
			enabled: Schema.optional(Schema.Boolean),
			command: Schema.optional(HookCommandSchema),
		}),
	),
});

export type HooksConfig = Schema.Schema.Type<typeof ResolvedHooksSchema>;
export interface MatchedPolicyRuleProvenance {
	readonly index: number;
	readonly matchPath: string;
	readonly predicates: {
		readonly path?: string;
		readonly pathGlob?: string;
		readonly scopeKind?: ScopeKind;
		readonly agent?: SpawnableAgentKind;
	};
	readonly policyChanges: readonly {
		readonly field: string;
		readonly add: readonly string[];
		readonly remove: readonly string[];
	}[];
}

export type ResolvedAgentManifest = Schema.Schema.Type<typeof ResolvedAgentSchema> & {
	readonly policies: readonly {
		readonly id: string;
		readonly path: string;
		readonly content: string;
	}[];
	readonly matchedRules: readonly MatchedPolicyRuleProvenance[];
	readonly ruleMatchPath: string;
};

interface ConfigLayer {
	readonly rootDir: string;
	readonly templatesDir: string;
	readonly agentsPath: string;
	readonly scopeKind: ScopeKind;
	readonly kind: "bundled" | "user";
	readonly required: boolean;
}

export interface ResolvedTemplateAsset {
	readonly reference: string;
	readonly path: string;
	readonly content: string;
	readonly layer:
		| { readonly type: "absolute" | "home" }
		| {
				readonly type: "layer";
				readonly kind: ConfigLayer["kind"];
				readonly scopeKind: ScopeKind;
				readonly rootDir: string;
		  };
}

type PartialAgentsFile = Schema.Schema.Type<typeof PartialAgentsFileSchema>;
type PolicyOps = Schema.Schema.Type<typeof PolicyListOpsSchema>;
type PolicyRule = Schema.Schema.Type<typeof PolicyRuleSchema>;

const POLICY_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

interface ResolvedConfig {
	readonly layers: readonly ConfigLayer[];
	readonly bundledLayer: ConfigLayer;
	readonly hooks: HooksConfig;
	readonly agents: Readonly<Record<SpawnableAgentKind, ResolvedAgentManifest>>;
}

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown, path: string): A => {
	const decoded = Schema.decodeUnknownEither(schema)(value);
	if (Either.isLeft(decoded)) {
		throw new SpawnerError({
			code: "VALIDATION_ERROR",
			message: `${path}: invalid manifest\n${ParseResult.TreeFormatter.formatErrorSync(decoded.left)}`,
		});
	}
	return decoded.right;
};

const isRecordValue = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const validateRawRuleKeys = (parsed: unknown, path: string): void => {
	if (!isRecordValue(parsed)) return;
	const rules = parsed.rules;
	if (rules === undefined) return;
	if (!Array.isArray(rules)) return;
	rules.forEach((rule, index) => {
		if (!isRecordValue(rule)) return;
		for (const key of Object.keys(rule)) {
			if (!allowedRuleKeys.has(key)) {
				throw new SpawnerError({
					code: "VALIDATION_ERROR",
					message: `${path}: rules[${index.toString()}] contains unknown predicate or field '${key}'`,
				});
			}
		}
	});
};

const parseTomlFile = (path: string, services: RenderServices): PartialAgentsFile => {
	let raw: string;
	try {
		raw = services.readText(path);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new SpawnerError({ code: "TEMPLATE_ERROR", message: `${path}: ${message}` });
	}
	let parsed: unknown;
	try {
		parsed = Toml.parse(raw);
	} catch (error) {
		throw new SpawnerError({
			code: "VALIDATION_ERROR",
			message: `${path}: invalid TOML\n${error instanceof Error ? error.message : String(error)}`,
		});
	}
	validateRawRuleKeys(parsed, path);
	return decode(PartialAgentsFileSchema, parsed, path);
};

const isEnoent = (error: unknown): boolean =>
	error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";

const maybeParseTomlFile = (
	path: string,
	services: RenderServices,
): PartialAgentsFile | undefined => {
	try {
		return parseTomlFile(path, services);
	} catch (error) {
		if (
			error instanceof SpawnerError &&
			error.code === "TEMPLATE_ERROR" &&
			error.message.includes("ENOENT")
		) {
			return undefined;
		}
		if (isEnoent(error)) return undefined;
		throw error;
	}
};

const uniqueValues = (values: readonly string[], field: string, path: string): void => {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) {
			throw new SpawnerError({
				code: "VALIDATION_ERROR",
				message: `${path}: ${field} contains duplicate value '${value}'`,
			});
		}
		seen.add(value);
	}
};

const validateListOps = (
	ops: Schema.Schema.Type<typeof ListOpsSchema> | Schema.Schema.Type<typeof ArgvListOpsSchema>,
	field: string,
	path: string,
	allowRemove: boolean,
	allowDuplicates: boolean,
): void => {
	const replace = "replace" in ops ? ops.replace : undefined;
	const remove = "remove" in ops ? ops.remove : undefined;
	const add = "add" in ops ? ops.add : undefined;
	if (replace !== undefined && (remove !== undefined || add !== undefined)) {
		throw new SpawnerError({
			code: "VALIDATION_ERROR",
			message: `${path}: ${field} replace may not be combined with add/remove`,
		});
	}
	if (!allowRemove && remove !== undefined) {
		throw new SpawnerError({
			code: "VALIDATION_ERROR",
			message: `${path}: ${field} does not support remove`,
		});
	}
	if (!allowDuplicates) {
		if (replace !== undefined) uniqueValues(replace, `${field}.replace`, path);
		if (remove !== undefined) uniqueValues(remove, `${field}.remove`, path);
		if (add !== undefined) uniqueValues(add, `${field}.add`, path);
	}
};

const allowedRuleKeys = new Set(["path", "path_glob", "scope_kind", "agent", "policy", "agents"]);
const regexMeta = /[\\^$+?.()|{}]/g;

const normalizeAbsolutePath = (reference: string, field: string, path: string): string => {
	const expanded = resolveAbsoluteOrHomePath(reference);
	if (!isAbsolute(expanded)) {
		throw new SpawnerError({
			code: "VALIDATION_ERROR",
			message: `${path}: ${field} must be absolute or start with ~/`,
		});
	}
	return normalize(expanded);
};

const globToRegExp = (glob: string, path: string, field: string): RegExp => {
	let pattern = "^";
	for (let index = 0; index < glob.length; index += 1) {
		const char = glob[index]!;
		if (char === "[") {
			throw new SpawnerError({
				code: "VALIDATION_ERROR",
				message: `${path}: ${field} contains unsupported glob character class syntax`,
			});
		}
		if (char === "*") {
			if (glob[index + 1] === "*") {
				pattern += ".*";
				index += 1;
			} else {
				pattern += "[^/]*";
			}
			continue;
		}
		pattern += char.replace(regexMeta, "\\$&");
	}
	return new RegExp(`${pattern}$`);
};

const scopeKindForInput = (input: RenderAgentInput): ScopeKind => {
	if (input.scopeKind !== undefined) return input.scopeKind;
	if (input.scopeId === "global") return "global";
	const pathScope = /^(repo|worktree):/.exec(input.scopeId);
	if (pathScope !== null) return pathScope[1] as ScopeKind;
	return "global";
};

const rawRuleMatchPathForInput = (input: RenderAgentInput): string => {
	if (input.scopeKind === "repo" || input.scopeKind === "worktree") {
		return input.scopePath === undefined || input.scopePath.length === 0
			? input.cwd
			: input.scopePath;
	}
	const pathScope = /^(repo|worktree):(.*)$/.exec(input.scopeId);
	const recordedPath = pathScope?.[2];
	return recordedPath === undefined || recordedPath.length === 0 ? input.cwd : recordedPath;
};

const ruleMatchPathForInput = (input: RenderAgentInput, path: string): string =>
	normalizeAbsolutePath(rawRuleMatchPathForInput(input), "launch path", path);

const policyChangesForRule = (
	rule: PolicyRule,
	agent: SpawnableAgentKind,
): MatchedPolicyRuleProvenance["policyChanges"] => {
	const changes: MatchedPolicyRuleProvenance["policyChanges"][number][] = [];
	if (rule.policy !== undefined) {
		changes.push({
			field: "rules.policy",
			add: rule.policy.add ?? [],
			remove: rule.policy.remove ?? [],
		});
	}
	const agentPolicy = rule.agents?.[agent]?.policy;
	if (agentPolicy !== undefined) {
		changes.push({
			field: `rules.agents.${agent}.policy`,
			add: agentPolicy.add ?? [],
			remove: agentPolicy.remove ?? [],
		});
	}
	return changes;
};

const ruleMatches = (
	rule: PolicyRule,
	input: RenderAgentInput,
	layer: ConfigLayer,
	matchPath: string,
): boolean => {
	const scopeKind = scopeKindForInput(input);
	if (
		rule.path !== undefined &&
		normalizeAbsolutePath(rule.path, "rules.path", layer.agentsPath) !== matchPath
	)
		return false;
	if (rule.path_glob !== undefined) {
		const pattern = globToRegExp(
			normalizeAbsolutePath(rule.path_glob, "rules.path_glob", layer.agentsPath),
			layer.agentsPath,
			"rules.path_glob",
		);
		if (!pattern.test(matchPath)) return false;
	}
	if (rule.scope_kind !== undefined && rule.scope_kind !== scopeKind) return false;
	if (rule.agent !== undefined && rule.agent !== input.agent) return false;
	return true;
};

const validatePartialFile = (file: PartialAgentsFile, layer: ConfigLayer): void => {
	for (const policyId of Object.keys(file.policies ?? {})) {
		if (!POLICY_ID_PATTERN.test(policyId)) {
			throw new SpawnerError({
				code: "VALIDATION_ERROR",
				message: `${layer.agentsPath}: invalid policy id '${policyId}'; expected lowercase kebab-case`,
			});
		}
	}
	if (file.policy !== undefined) {
		validatePolicyOps(file.policy, "policy", layer.agentsPath);
	}
	file.rules?.forEach((rule, index) => {
		if (rule.policy !== undefined) {
			validatePolicyOps(rule.policy, `rules[${index.toString()}].policy`, layer.agentsPath);
		}
		if (rule.path !== undefined) {
			normalizeAbsolutePath(rule.path, `rules[${index.toString()}].path`, layer.agentsPath);
		}
		if (rule.path_glob !== undefined) {
			globToRegExp(
				normalizeAbsolutePath(
					rule.path_glob,
					`rules[${index.toString()}].path_glob`,
					layer.agentsPath,
				),
				layer.agentsPath,
				`rules[${index.toString()}].path_glob`,
			);
		}
		for (const [agent, partial] of Object.entries(rule.agents ?? {})) {
			if (partial?.policy !== undefined) {
				validatePolicyOps(
					partial.policy,
					`rules[${index.toString()}].agents.${agent}.policy`,
					layer.agentsPath,
				);
			}
			if (
				partial?.template !== undefined ||
				partial?.includes !== undefined ||
				partial?.appends !== undefined ||
				partial?.harness !== undefined
			) {
				throw new SpawnerError({
					code: "VALIDATION_ERROR",
					message: `${layer.agentsPath}: rules[${index.toString()}].agents.${agent} may only configure policy`,
				});
			}
		}
	});
	for (const [agent, partial] of Object.entries(file.agents ?? {})) {
		if (partial === undefined) continue;
		if (partial.includes !== undefined) {
			validateListOps(partial.includes, `agents.${agent}.includes`, layer.agentsPath, true, false);
		}
		if (partial.appends !== undefined) {
			validateListOps(partial.appends, `agents.${agent}.appends`, layer.agentsPath, true, false);
		}
		if (partial.policy !== undefined) {
			validatePolicyOps(partial.policy, `agents.${agent}.policy`, layer.agentsPath);
		}
		if (partial.harness?.tools !== undefined) {
			validateListOps(
				partial.harness.tools,
				`agents.${agent}.harness.tools`,
				layer.agentsPath,
				true,
				false,
			);
		}
		if (partial.harness?.argv !== undefined) {
			validateListOps(
				partial.harness.argv,
				`agents.${agent}.harness.argv`,
				layer.agentsPath,
				false,
				true,
			);
		}
	}
	const input = file.hooks?.input;
	if (input?.enabled === false && input.command !== undefined) {
		throw new SpawnerError({
			code: "VALIDATION_ERROR",
			message: `${layer.agentsPath}: hooks.input may not set enabled=false together with command`,
		});
	}
	if (
		layer.kind !== "bundled" &&
		Object.values(file.agents ?? {}).some(
			(partial) =>
				partial?.template !== undefined ||
				partial?.includes !== undefined ||
				partial?.appends !== undefined,
		)
	) {
		throw new SpawnerError({
			code: "VALIDATION_ERROR",
			message: `${layer.agentsPath}: user manifest may not configure agents.<kind>.template, agents.<kind>.includes, or agents.<kind>.appends`,
		});
	}
};

const validatePolicyOps = (ops: PolicyOps, field: string, path: string): void => {
	if (ops.replace !== undefined) {
		throw new SpawnerError({
			code: "VALIDATION_ERROR",
			message: `${path}: ${field}.replace is not supported`,
		});
	}
	validateListOps(ops, field, path, true, false);
	for (const policyId of [...(ops.add ?? []), ...(ops.remove ?? [])]) {
		if (!POLICY_ID_PATTERN.test(policyId)) {
			throw new SpawnerError({
				code: "VALIDATION_ERROR",
				message: `${path}: invalid policy id '${policyId}'; expected lowercase kebab-case`,
			});
		}
	}
};

const agentModeFor = (agent: SpawnableAgentKind): "afk" | "hitl" =>
	agent === "pandora" || agent === "greed" ? "hitl" : "afk";

const mergeUniqueList = (
	current: readonly string[],
	ops: Schema.Schema.Type<typeof ListOpsSchema> | undefined,
	field: string,
	path: string,
): readonly string[] => {
	if (ops === undefined) return current;
	if (ops.replace !== undefined) return ops.replace;
	const next = [...current];
	for (const value of ops.remove ?? []) {
		const index = next.indexOf(value);
		if (index === -1) {
			throw new SpawnerError({
				code: "VALIDATION_ERROR",
				message: `${path}: ${field} cannot remove absent value '${value}'`,
			});
		}
		next.splice(index, 1);
	}
	for (const value of ops.add ?? []) {
		if (next.includes(value)) {
			throw new SpawnerError({
				code: "VALIDATION_ERROR",
				message: `${path}: ${field} cannot add duplicate value '${value}'`,
			});
		}
		next.push(value);
	}
	return next;
};

const mergeArgvList = (
	current: readonly string[],
	ops: Schema.Schema.Type<typeof ArgvListOpsSchema> | undefined,
): readonly string[] => {
	if (ops === undefined) return current;
	if (ops.replace !== undefined) return ops.replace;
	return [...current, ...(ops.add ?? [])];
};

const resolvePolicyPath = (reference: string, layer: ConfigLayer): string => {
	if (reference === "~") return homedir();
	if (reference.startsWith("~/")) return join(homedir(), reference.slice(2));
	if (isAbsolute(reference)) return reference;
	if (reference.split("/").includes("..")) {
		throw new SpawnerError({
			code: "VALIDATION_ERROR",
			message: `${layer.agentsPath}: policy file '${reference}' must resolve under ${layer.rootDir}`,
		});
	}
	return join(layer.rootDir, reference);
};

const resolveLayer = (
	rootDir: string,
	scopeKind: ScopeKind,
	kind: ConfigLayer["kind"],
	required: boolean,
): ConfigLayer => ({
	rootDir,
	templatesDir: join(rootDir, "templates"),
	agentsPath: kind === "bundled" ? resolveAgentsPath(rootDir) : join(rootDir, "agents.toml"),
	scopeKind,
	kind,
	required,
});

const bundledLayerFor = (services: RenderServices): ConfigLayer => {
	const dataDir = services.env("PDX_DATA_DIR");
	return {
		rootDir: dataDir ?? bundledDataDirResourcesDir,
		templatesDir: resolveTemplatesDir(dataDir),
		agentsPath: resolveAgentsPath(dataDir),
		scopeKind: "global",
		kind: "bundled",
		required: true,
	};
};

const layerOrderForRender = (
	_input: RenderAgentInput,
	services: RenderServices,
): readonly ConfigLayer[] => {
	const bundledLayer = bundledLayerFor(services);
	const dataDir = services.env("PDX_DATA_DIR");
	const userDataDir = resolveUserDataDir(dataDir, services.env("PDX_USER_DATA_DIR"));
	return userDataDir === undefined
		? [bundledLayer]
		: [bundledLayer, resolveLayer(userDataDir, "global", "user", false)];
};

const hookLayers = (services: RenderServices): readonly ConfigLayer[] => {
	const bundledLayer = bundledLayerFor(services);
	const dataDir = services.env("PDX_DATA_DIR");
	const userDataDir = resolveUserDataDir(dataDir, services.env("PDX_USER_DATA_DIR"));
	return userDataDir === undefined
		? [bundledLayer]
		: [bundledLayer, resolveLayer(userDataDir, "global", "user", false)];
};

const readLayerFiles = (
	layers: readonly ConfigLayer[],
	services: RenderServices,
): readonly [ConfigLayer, PartialAgentsFile][] => {
	const files: [ConfigLayer, PartialAgentsFile][] = [];
	for (const layer of layers) {
		const parsed = layer.required
			? parseTomlFile(layer.agentsPath, services)
			: maybeParseTomlFile(layer.agentsPath, services);
		if (parsed !== undefined) {
			validatePartialFile(parsed, layer);
			files.push([layer, parsed]);
		}
	}
	return files;
};

const buildResolvedConfig = (
	layers: readonly ConfigLayer[],
	services: RenderServices,
	input: RenderAgentInput,
): ResolvedConfig => {
	const layerFiles = readLayerFiles(layers, services);
	const bundledLayerEntry = layerFiles[0];
	if (bundledLayerEntry === undefined) {
		throw new SpawnerError({ code: "VALIDATION_ERROR", message: "missing bundled agents.toml" });
	}
	const [bundledLayer, bundledFile] = bundledLayerEntry;
	const agents = Object.fromEntries(
		BUILTIN_SPAWNABLE_AGENT_KINDS.map((agent) => {
			const bundledAgent = bundledFile.agents?.[agent];
			if (bundledAgent === undefined) {
				throw new SpawnerError({
					code: "VALIDATION_ERROR",
					message: `${bundledLayer.agentsPath}: missing canonical agents.${agent}`,
				});
			}
			const resolved = {
				template: bundledAgent.template,
				includes: bundledAgent.includes?.replace ?? [],
				appends: bundledAgent.appends?.replace ?? [],
				policyIds: [] as readonly string[],
				harness: {
					kind: bundledAgent.harness?.kind,
					model: bundledAgent.harness?.model,
					system_prompt_mode: bundledAgent.harness?.system_prompt_mode,
					tools: bundledAgent.harness?.tools?.replace,
					argv: bundledAgent.harness?.argv?.replace ?? [],
				},
			};
			return [agent, resolved];
		}),
	) as Record<
		SpawnableAgentKind,
		{
			template: string | undefined;
			includes: readonly string[];
			appends: readonly string[];
			policyIds: readonly string[];
			harness: {
				kind: "claude" | "pi" | undefined;
				model: string | undefined;
				system_prompt_mode: "replace" | "append" | undefined;
				tools: readonly string[] | undefined;
				argv: readonly string[];
			};
		}
	>;
	let hooks: HooksConfig = decode(
		ResolvedHooksSchema,
		bundledFile.hooks ?? {},
		bundledLayer.agentsPath,
	);

	const policyDeclarations = new Map<string, string>();
	const matchedRules: MatchedPolicyRuleProvenance[] = [];
	const ruleMatchPath = ruleMatchPathForInput(input, bundledLayer.agentsPath);
	for (const [layer, file] of layerFiles.slice(1)) {
		for (const [policyId, declaration] of Object.entries(file.policies ?? {})) {
			policyDeclarations.set(policyId, resolvePolicyPath(declaration.file, layer));
		}
		for (const agent of BUILTIN_SPAWNABLE_AGENT_KINDS) {
			const partial = file.agents?.[agent];
			const current = agents[agent];
			current.policyIds = mergeUniqueList(
				current.policyIds,
				file.policy,
				"policy",
				layer.agentsPath,
			);
			if (partial !== undefined) {
				current.policyIds = mergeUniqueList(
					current.policyIds,
					partial.policy,
					`agents.${agent}.policy`,
					layer.agentsPath,
				);
			}
			if (agent === input.agent) {
				file.rules?.forEach((rule, index) => {
					if (!ruleMatches(rule, input, layer, ruleMatchPath)) return;
					current.policyIds = mergeUniqueList(
						current.policyIds,
						rule.policy,
						`rules[${index.toString()}].policy`,
						layer.agentsPath,
					);
					const agentPolicy = rule.agents?.[agent]?.policy;
					current.policyIds = mergeUniqueList(
						current.policyIds,
						agentPolicy,
						`rules[${index.toString()}].agents.${agent}.policy`,
						layer.agentsPath,
					);
					matchedRules.push({
						index,
						matchPath: ruleMatchPath,
						predicates: {
							...(rule.path === undefined
								? {}
								: { path: normalizeAbsolutePath(rule.path, "rules.path", layer.agentsPath) }),
							...(rule.path_glob === undefined
								? {}
								: {
										pathGlob: normalizeAbsolutePath(
											rule.path_glob,
											"rules.path_glob",
											layer.agentsPath,
										),
									}),
							...(rule.scope_kind === undefined ? {} : { scopeKind: rule.scope_kind }),
							...(rule.agent === undefined ? {} : { agent: rule.agent }),
						},
						policyChanges: policyChangesForRule(rule, agent),
					});
				});
			}
			if (partial === undefined) continue;

			if (partial.harness?.kind !== undefined) current.harness.kind = partial.harness.kind;
			if (partial.harness?.model !== undefined) current.harness.model = partial.harness.model;
			if (partial.harness?.system_prompt_mode !== undefined) {
				current.harness.system_prompt_mode = partial.harness.system_prompt_mode;
			}
			if (partial.harness?.tools !== undefined) {
				current.harness.tools = mergeUniqueList(
					current.harness.tools ?? [],
					partial.harness.tools,
					`agents.${agent}.harness.tools`,
					layer.agentsPath,
				);
			}
			current.harness.argv = mergeArgvList(current.harness.argv, partial.harness?.argv);
		}
		const hookInput = file.hooks?.input;
		if (hookInput !== undefined) {
			const nextInput = {
				enabled: hookInput.enabled ?? hooks.input?.enabled,
				command: hookInput.command ?? hooks.input?.command,
			};
			hooks = decode(ResolvedHooksSchema, { input: nextInput }, layer.agentsPath);
		}
	}

	const resolvedAgents = Object.fromEntries(
		BUILTIN_SPAWNABLE_AGENT_KINDS.map((agent) => {
			const current = agents[agent];
			const policies = current.policyIds.map((policyId) => {
				const declaration = policyDeclarations.get(policyId);
				if (declaration === undefined) {
					throw new SpawnerError({
						code: "VALIDATION_ERROR",
						message: `${bundledLayer.agentsPath}: selected policy '${policyId}' has no policies.${policyId}.file declaration`,
					});
				}
				return {
					id: policyId,
					path: declaration,
					content: readPolicyText(declaration, services),
				};
			});
			const resolved = decode(
				ResolvedAgentSchema,
				{
					template: current.template,
					includes: current.includes,
					appends: current.appends,
					harness: {
						kind: current.harness.kind,
						model: current.harness.model,
						system_prompt_mode: current.harness.system_prompt_mode,
						tools: current.harness.tools,
						argv: current.harness.argv,
					},
				},
				`${bundledLayer.agentsPath}: resolved agents.${agent}`,
			);
			uniqueValues(resolved.includes, `agents.${agent}.includes`, bundledLayer.agentsPath);
			uniqueValues(resolved.appends, `agents.${agent}.appends`, bundledLayer.agentsPath);
			if (resolved.harness.tools !== undefined) {
				uniqueValues(
					resolved.harness.tools,
					`agents.${agent}.harness.tools`,
					bundledLayer.agentsPath,
				);
			}
			return [
				agent,
				{
					...resolved,
					policies,
					matchedRules: agent === input.agent ? matchedRules : [],
					ruleMatchPath,
				},
			];
		}),
	) as unknown as Readonly<Record<SpawnableAgentKind, ResolvedAgentManifest>>;
	return { layers, bundledLayer, hooks, agents: resolvedAgents };
};

const resolveAbsoluteOrHomePath = (reference: string): string => {
	if (reference === "~") return homedir();
	if (reference.startsWith("~/")) return join(homedir(), reference.slice(2));
	return reference;
};

const readText = (path: string, services: RenderServices): string => {
	try {
		return services.readText(path);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new SpawnerError({ code: "TEMPLATE_ERROR", message: `${path}: ${message}` });
	}
};

const readPolicyText = (path: string, services: RenderServices): string => {
	try {
		return services.readText(path);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new SpawnerError({ code: "VALIDATION_ERROR", message: `${path}: ${message}` });
	}
};

export const loadResolvedAgentConfig = (
	input: RenderAgentInput,
	services: RenderServices,
): ResolvedConfig => buildResolvedConfig(layerOrderForRender(input, services), services, input);

export const loadResolvedHooks = (services: RenderServices): HooksConfig => {
	const layerFiles = readLayerFiles(hookLayers(services), services);
	const bundledLayerEntry = layerFiles[0];
	if (bundledLayerEntry === undefined) {
		throw new SpawnerError({ code: "VALIDATION_ERROR", message: "missing bundled agents.toml" });
	}
	const [bundledLayer, bundledFile] = bundledLayerEntry;
	let hooks: HooksConfig = decode(
		ResolvedHooksSchema,
		bundledFile.hooks ?? {},
		bundledLayer.agentsPath,
	);
	for (const [layer, file] of layerFiles.slice(1)) {
		const hookInput = file.hooks?.input;
		if (hookInput !== undefined) {
			const nextInput = {
				enabled: hookInput.enabled ?? hooks.input?.enabled,
				command: hookInput.command ?? hooks.input?.command,
			};
			hooks = decode(ResolvedHooksSchema, { input: nextInput }, layer.agentsPath);
		}
	}
	return hooks;
};

export const resolveTemplateAsset = (
	reference: string,
	config: Pick<ResolvedConfig, "layers" | "bundledLayer">,
	services: RenderServices,
): ResolvedTemplateAsset => {
	if (reference === "~" || reference.startsWith("~/") || reference.startsWith("/")) {
		const path = resolveAbsoluteOrHomePath(reference);
		return {
			reference,
			path,
			content: readText(path, services),
			layer: { type: reference.startsWith("/") ? "absolute" : "home" },
		};
	}
	const path = join(config.bundledLayer.templatesDir, reference);
	return {
		reference,
		path,
		content: readText(path, services),
		layer: {
			type: "layer",
			kind: config.bundledLayer.kind,
			scopeKind: config.bundledLayer.scopeKind,
			rootDir: config.bundledLayer.rootDir,
		},
	};
};

export { agentModeFor, type ConfigLayer, type ResolvedConfig, type ScopeKind };
