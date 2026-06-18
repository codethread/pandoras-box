import TOML from "@iarna/toml";
import { Effect, ParseResult, Schema } from "effect";
import { relative, resolve, sep } from "node:path";
import { PdxError } from "./errors.js";

export const RawPdxConfigSchema = Schema.Struct({
	dataDir: Schema.optional(Schema.NonEmptyString),
	envDataDir: Schema.optional(Schema.NonEmptyString),
	envUserDataDir: Schema.optional(Schema.NonEmptyString),
	envHome: Schema.optional(Schema.NonEmptyString),
	daemonEntrypoint: Schema.NonEmptyString,
});

export interface SupervisorLaunchPolicy {
	readonly launch_preconditions: {
		readonly enforce_repo_root_trunk: boolean;
	};
}

export const defaultSupervisorLaunchPolicy: SupervisorLaunchPolicy = {
	launch_preconditions: { enforce_repo_root_trunk: true },
};

export interface PdxConfig {
	readonly dataDir: string;
	readonly userDataDir: string;
	readonly socketPath: string;
	readonly intakeSocketPath: string;
	readonly logPath: string;
	readonly runsDir: string;
	readonly daemonEntrypoint: string;
	readonly pithosDbPath: string;
}

const isSamePath = (left: string, right: string): boolean => left === right;

const isAncestorPath = (ancestor: string, path: string): boolean => {
	const rel = relative(ancestor, path);
	return rel.length > 0 && rel !== ".." && !rel.startsWith(`..${sep}`) && rel !== ".";
};

const validateUserDataDir = (
	dataDir: string,
	rawUserDataDir: string | undefined,
	envHome: string | undefined,
): Effect.Effect<string, PdxError> => {
	const defaultUserDataDir = resolve(dataDir, "config");
	const userDataDir =
		rawUserDataDir === undefined
			? defaultUserDataDir
			: rawUserDataDir === "~"
				? envHome === undefined
					? "__missing_home__"
					: resolve(envHome)
				: rawUserDataDir.startsWith("~/")
					? envHome === undefined
						? "__missing_home__"
						: resolve(envHome, rawUserDataDir.slice(2))
					: resolve(rawUserDataDir);
	if (userDataDir === "__missing_home__") {
		return Effect.fail(
			new PdxError({
				code: "CONFIG_ERROR",
				message: "PDX_USER_DATA_DIR uses ~/ but HOME env is missing",
			}),
		);
	}
	if (isSamePath(userDataDir, dataDir)) {
		return Effect.fail(
			new PdxError({
				code: "CONFIG_ERROR",
				message: `PDX_USER_DATA_DIR must not equal PDX_DATA_DIR: ${dataDir}`,
			}),
		);
	}
	if (isAncestorPath(userDataDir, dataDir)) {
		return Effect.fail(
			new PdxError({
				code: "CONFIG_ERROR",
				message: `PDX_USER_DATA_DIR must not be an ancestor of PDX_DATA_DIR: ${userDataDir} -> ${dataDir}`,
			}),
		);
	}
	if (isAncestorPath(dataDir, userDataDir) && !isSamePath(userDataDir, defaultUserDataDir)) {
		return Effect.fail(
			new PdxError({
				code: "CONFIG_ERROR",
				message: `PDX_USER_DATA_DIR inside PDX_DATA_DIR is only allowed at ${defaultUserDataDir}; got ${userDataDir}`,
			}),
		);
	}
	return Effect.succeed(userDataDir);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const unknownKeys = (
	value: Record<string, unknown>,
	allowed: readonly string[],
): readonly string[] => Object.keys(value).filter((key) => !allowed.includes(key));

export const parseSupervisorLaunchPolicyToml = (
	content: string | undefined,
): Effect.Effect<SupervisorLaunchPolicy, PdxError> => {
	if (content === undefined) return Effect.succeed(defaultSupervisorLaunchPolicy);
	return Effect.try({
		try: () => TOML.parse(content),
		catch: (error) =>
			new PdxError({
				code: "CONFIG_ERROR",
				message: `Invalid supervisor.toml: ${String(error)}`,
			}),
	}).pipe(
		Effect.flatMap((parsed) => {
			if (!isRecord(parsed)) {
				return Effect.fail(
					new PdxError({
						code: "CONFIG_ERROR",
						message: "Invalid supervisor.toml: root must be a TOML table",
					}),
				);
			}
			const rootUnknown = unknownKeys(parsed, ["launch_preconditions"]);
			if (rootUnknown.length > 0) {
				return Effect.fail(
					new PdxError({
						code: "CONFIG_ERROR",
						message: `Invalid supervisor.toml: unknown root field(s): ${rootUnknown.join(", ")}`,
					}),
				);
			}
			const launchPreconditions = parsed.launch_preconditions;
			if (!isRecord(launchPreconditions)) {
				return Effect.fail(
					new PdxError({
						code: "CONFIG_ERROR",
						message: "Invalid supervisor.toml: launch_preconditions table is required",
					}),
				);
			}
			const preconditionUnknown = unknownKeys(launchPreconditions, ["enforce_repo_root_trunk"]);
			if (preconditionUnknown.length > 0) {
				return Effect.fail(
					new PdxError({
						code: "CONFIG_ERROR",
						message: `Invalid supervisor.toml: unknown launch_preconditions field(s): ${preconditionUnknown.join(", ")}`,
					}),
				);
			}
			const enforceRepoRootTrunk = launchPreconditions.enforce_repo_root_trunk;
			if (typeof enforceRepoRootTrunk !== "boolean") {
				return Effect.fail(
					new PdxError({
						code: "CONFIG_ERROR",
						message:
							"Invalid supervisor.toml: launch_preconditions.enforce_repo_root_trunk must be a boolean",
					}),
				);
			}
			return Effect.succeed({
				launch_preconditions: { enforce_repo_root_trunk: enforceRepoRootTrunk },
			});
		}),
	);
};

export const parsePdxConfig = (input: unknown): Effect.Effect<PdxConfig, PdxError> =>
	Schema.decodeUnknown(RawPdxConfigSchema)(input, { errors: "all" }).pipe(
		Effect.mapError(
			(error) =>
				new PdxError({
					code: "CONFIG_ERROR",
					message: `Invalid pdx config: ${ParseResult.TreeFormatter.formatErrorSync(error)}`,
				}),
		),
		Effect.flatMap((decoded) => {
			if (
				decoded.dataDir === undefined &&
				decoded.envDataDir === undefined &&
				decoded.envHome === undefined
			) {
				return Effect.fail(
					new PdxError({
						code: "CONFIG_ERROR",
						message: "missing required data dir (provide --data-dir, PDX_DATA_DIR, or HOME env)",
					}),
				);
			}
			const dataDir = resolve(decoded.dataDir ?? decoded.envDataDir ?? `${decoded.envHome}/.pdx`);
			return validateUserDataDir(dataDir, decoded.envUserDataDir, decoded.envHome).pipe(
				Effect.map((userDataDir) => ({
					dataDir,
					userDataDir,
					socketPath: `${dataDir}/pdx.sock`,
					intakeSocketPath: `${dataDir}/intake.sock`,
					logPath: `${dataDir}/pdx.jsonl`,
					runsDir: `${dataDir}/runs`,
					daemonEntrypoint: decoded.daemonEntrypoint,
					pithosDbPath: `${dataDir}/pithos.sqlite`,
				})),
			);
		}),
	);
