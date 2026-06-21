import { Data } from "effect";

export interface FagentServices {
	readonly readText: (path: string) => string;
	readonly resolvePath: (cwd: string, path: string) => string;
}

export type FagentErrorCode = "ARGV_ERROR" | "CONFIG_ERROR" | "NO_RESPONSE" | "READ_ERROR";

export class FagentError extends Data.TaggedError("FagentError")<{
	readonly code: FagentErrorCode;
	readonly message: string;
}> {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const parseResponses = (raw: unknown): Readonly<Record<string, string>> => {
	if (!isRecord(raw) || !isRecord(raw.responses)) {
		throw new FagentError({
			code: "CONFIG_ERROR",
			message: "fagent config must be an object with a responses object",
		});
	}
	const responses: Record<string, string> = {};
	for (const [input, response] of Object.entries(raw.responses)) {
		if (typeof response !== "string") {
			throw new FagentError({
				code: "CONFIG_ERROR",
				message: `response for ${input} must be a string`,
			});
		}
		responses[input] = response;
	}
	return responses;
};

const readResponses = (
	configPath: string,
	services: FagentServices,
): Readonly<Record<string, string>> => {
	try {
		return parseResponses(JSON.parse(services.readText(configPath)));
	} catch (error) {
		if (error instanceof FagentError) throw error;
		throw new FagentError({
			code: "CONFIG_ERROR",
			message: `failed to load fagent config ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
		});
	}
};

const valueFlags = new Set([
	"--config",
	"--print",
	"--session-id",
	"--model",
	"--tools",
	"--system-prompt",
	"--append-system-prompt",
]);

const argvValue = (argv: readonly string[], index: number, flag: string): string => {
	const value = argv[index + 1];
	if (value === undefined || valueFlags.has(value)) {
		throw new FagentError({ code: "ARGV_ERROR", message: `${flag} requires a value` });
	}
	return value;
};

const parseStartup = (
	argv: readonly string[],
): { readonly configPath: string; readonly input: string } => {
	let configPath: string | undefined;
	let input: string | undefined;
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--config") {
			configPath = argvValue(argv, index, token);
			index += 1;
		} else if (token === "--print") {
			input = argvValue(argv, index, token);
			index += 1;
		} else if (token !== undefined && valueFlags.has(token)) {
			argvValue(argv, index, token);
			index += 1;
		}
	}
	if (configPath === undefined) {
		throw new FagentError({ code: "ARGV_ERROR", message: "missing required --config path" });
	}
	if (input === undefined) {
		throw new FagentError({ code: "ARGV_ERROR", message: "missing required --print input" });
	}
	return { configPath, input };
};

const readFiles = (cwd: string, input: string, services: FagentServices): string => {
	const filePaths = input
		.slice("READ ".length)
		.split(",")
		.map((part) => part.trim());
	if (filePaths.some((path) => path.length === 0)) {
		throw new FagentError({
			code: "READ_ERROR",
			message: "READ requires a comma-separated file list",
		});
	}
	const sections = filePaths.map((filePath) => {
		try {
			return [`FILE ${filePath}`, services.readText(services.resolvePath(cwd, filePath))].join(
				"\n",
			);
		} catch (error) {
			throw new FagentError({
				code: "READ_ERROR",
				message: `failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	});
	return ["READ_RESULT", ...sections].join("\n");
};

export const runFagent = (
	argv: readonly string[],
	cwd: string,
	services: FagentServices,
): string => {
	const { configPath, input } = parseStartup(argv);
	if (input.startsWith("READ ")) {
		return readFiles(cwd, input, services);
	}
	const response = readResponses(configPath, services)[input];
	if (response === undefined) {
		throw new FagentError({
			code: "NO_RESPONSE",
			message: `no configured fagent response for input: ${input}`,
		});
	}
	return response;
};
