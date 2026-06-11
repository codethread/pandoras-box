import * as Toml from "@iarna/toml";
import { Effect } from "effect";
import { BUILTIN_CAPABILITIES, type Capability } from "./builtins.js";
import { PithosError } from "./errors.js";
import type { EnvReader } from "./config.js";
import type { FsService } from "./services.js";

export interface ArtifactContractRule {
	readonly capability: Capability;
	readonly kind: string;
	readonly required: boolean;
	readonly title: string;
	readonly body: string;
}

export interface ArtifactContract {
	readonly artifacts: readonly ArtifactContractRule[];
}

const ARTIFACTS_FILE = "artifacts.toml";
const KIND_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const RULE_FIELDS = new Set(["capability", "kind", "required", "title", "body"]);
const CAPABILITIES = new Set<string>(BUILTIN_CAPABILITIES);

const emptyContract: ArtifactContract = { artifacts: [] };

const validationError = (message: string): PithosError =>
	new PithosError({ code: "VALIDATION_ERROR", message });

const userError = (message: string): PithosError =>
	new PithosError({ code: "USER_ERROR", message });

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const assertString = (value: unknown, field: string, index: number): string => {
	if (typeof value !== "string") {
		throw validationError(`artifacts[${index}].${field} must be a string`);
	}
	if (value.trim().length === 0) {
		throw validationError(`artifacts[${index}].${field} must be non-empty`);
	}
	return value;
};

const normalizeRule = (value: unknown, index: number): ArtifactContractRule => {
	if (!isRecord(value)) throw validationError(`artifacts[${index}] must be a table`);
	for (const key of Object.keys(value)) {
		if (!RULE_FIELDS.has(key)) throw validationError(`unknown artifacts[${index}] field: ${key}`);
	}
	const capability = assertString(value.capability, "capability", index);
	if (!CAPABILITIES.has(capability)) {
		throw validationError(
			`artifacts[${index}].capability is not a built-in Capability: ${capability}`,
		);
	}
	const kind = assertString(value.kind, "kind", index);
	if (!KIND_PATTERN.test(kind)) {
		throw validationError(`artifacts[${index}].kind must be lower snake case`);
	}
	let required = false;
	if (value.required !== undefined) {
		if (typeof value.required !== "boolean") {
			throw validationError(`artifacts[${index}].required must be a boolean`);
		}
		required = value.required;
	}
	return {
		capability: capability as Capability,
		kind,
		required,
		title: assertString(value.title, "title", index),
		body: assertString(value.body, "body", index),
	};
};

export const parseArtifactContractToml = (text: string): ArtifactContract => {
	let parsed: unknown;
	try {
		parsed = Toml.parse(text);
	} catch (error) {
		throw validationError(
			`invalid artifacts.toml: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isRecord(parsed)) throw validationError("artifacts.toml must contain a table");
	const keys = Object.keys(parsed);
	for (const key of keys) {
		if (key !== "artifacts")
			throw validationError(`unknown artifacts.toml top-level field: ${key}`);
	}
	if (parsed.artifacts === undefined) return emptyContract;
	if (!Array.isArray(parsed.artifacts)) throw validationError("artifacts must be an array");
	const seen = new Set<string>();
	const artifacts = parsed.artifacts.map((rule, index) => {
		const normalized = normalizeRule(rule, index);
		const duplicateKey = `${normalized.capability}:${normalized.kind}`;
		if (seen.has(duplicateKey)) {
			throw validationError(
				`duplicate artifact rule for ${normalized.capability}/${normalized.kind}`,
			);
		}
		seen.add(duplicateKey);
		return normalized;
	});
	return { artifacts };
};

export const selectArtifactContractRules = (
	contract: ArtifactContract,
	capabilities: Iterable<Capability>,
): ArtifactContract => {
	const allowed = new Set(capabilities);
	return { artifacts: contract.artifacts.filter((rule) => allowed.has(rule.capability)) };
};

const artifactsPath = (userDataDir: string): string =>
	userDataDir.endsWith("/")
		? `${userDataDir}${ARTIFACTS_FILE}`
		: `${userDataDir}/${ARTIFACTS_FILE}`;

const isMissingArtifactsToml = (error: PithosError): boolean =>
	error.message.includes("ENOENT") || error.message.includes("no such file or directory");

export const loadArtifactContract = (
	env: EnvReader,
	fs: FsService,
): Effect.Effect<ArtifactContract, PithosError> => {
	const userDataDir = env.get("PDX_USER_DATA_DIR");
	if (userDataDir === undefined) return Effect.succeed(emptyContract);
	return Effect.gen(function* () {
		const exists = yield* fs.existsDirectory(userDataDir);
		if (!exists) {
			return yield* Effect.fail(
				userError(`PDX_USER_DATA_DIR is not an inspectable directory: ${userDataDir}`),
			);
		}
		const path = artifactsPath(userDataDir);
		const text = yield* fs
			.readText(path)
			.pipe(
				Effect.catchAll((error) =>
					isMissingArtifactsToml(error) ? Effect.succeed(undefined) : Effect.fail(error),
				),
			);
		if (text === undefined) return emptyContract;
		return yield* Effect.try({
			try: () => parseArtifactContractToml(text),
			catch: (error) =>
				error instanceof PithosError
					? error
					: new PithosError({
							code: "INTERNAL_ERROR",
							message: error instanceof Error ? error.message : String(error),
						}),
		});
	});
};
