import { Data } from "effect";

export interface FagentServices {
	readonly readText: (path: string) => string;
	readonly resolvePath: (cwd: string, path: string) => string;
	readonly appendText?: (path: string, text: string) => void;
	readonly execFile?: (file: string, args: readonly string[], input?: string) => string;
	readonly env?: Readonly<Record<string, string | undefined>>;
}

export type FagentErrorCode =
	| "ARGV_ERROR"
	| "CONFIG_ERROR"
	| "NO_RESPONSE"
	| "READ_ERROR"
	| "SCRIPT_ERROR";

export class FagentError extends Data.TaggedError("FagentError")<{
	readonly code: FagentErrorCode;
	readonly message: string;
}> {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (raw: Record<string, unknown>, key: string): string => {
	const value = raw[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new FagentError({ code: "CONFIG_ERROR", message: `${key} must be a non-empty string` });
	}
	return value;
};

const passthroughValueFlags = new Set([
	"--session-id",
	"--model",
	"--tools",
	"--system-prompt",
	"--append-system-prompt",
]);

const argvValue = (argv: readonly string[], index: number, flag: string): string => {
	const value = argv[index + 1];
	if (value === undefined || value.startsWith("--")) {
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
		} else if (token !== undefined && passthroughValueFlags.has(token)) {
			argvValue(argv, index, token);
			index += 1;
		} else if (token !== undefined) {
			throw new FagentError({ code: "ARGV_ERROR", message: `unsupported argv token: ${token}` });
		}
	}
	if (configPath === undefined)
		throw new FagentError({ code: "ARGV_ERROR", message: "missing required --config path" });
	if (input === undefined)
		throw new FagentError({ code: "ARGV_ERROR", message: "missing required --print input" });
	return { configPath, input };
};

type Action = "claim" | "enqueue_execute" | "fail_execute_once" | "repair_replay" | "complete";

interface Script {
	readonly agentKind: string;
	readonly capability: string;
	readonly pithosPath: string;
	readonly eventLogPath: string;
	readonly actions: readonly Action[];
	readonly executeScopeId?: string;
	readonly hitl?: boolean;
}

interface Config {
	readonly responses: Readonly<Record<string, string>>;
	readonly scripts: Readonly<Record<string, Script>>;
}

const allowedActions = new Set<Action>([
	"claim",
	"enqueue_execute",
	"fail_execute_once",
	"repair_replay",
	"complete",
]);

const parseActions = (value: unknown, scriptName: string): readonly Action[] => {
	if (!Array.isArray(value)) {
		throw new FagentError({
			code: "CONFIG_ERROR",
			message: `script for ${scriptName} must have actions`,
		});
	}
	return value.map((action) => {
		if (!allowedActions.has(action as Action)) {
			throw new FagentError({
				code: "CONFIG_ERROR",
				message: `unsupported script action ${String(action)}`,
			});
		}
		return action as Action;
	});
};

const parseConfig = (raw: unknown): Config => {
	if (!isRecord(raw)) {
		throw new FagentError({ code: "CONFIG_ERROR", message: "fagent config must be an object" });
	}

	const responses: Record<string, string> = {};
	if (raw.responses !== undefined) {
		if (!isRecord(raw.responses)) {
			throw new FagentError({ code: "CONFIG_ERROR", message: "responses must be an object" });
		}
		for (const [input, response] of Object.entries(raw.responses)) {
			if (typeof response !== "string") {
				throw new FagentError({
					code: "CONFIG_ERROR",
					message: `response for ${input} must be a string`,
				});
			}
			responses[input] = response;
		}
	}

	const scripts: Record<string, Script> = {};
	if (raw.scripts !== undefined) {
		if (!isRecord(raw.scripts)) {
			throw new FagentError({ code: "CONFIG_ERROR", message: "scripts must be an object" });
		}
		for (const [input, scriptRaw] of Object.entries(raw.scripts)) {
			if (!isRecord(scriptRaw)) {
				throw new FagentError({
					code: "CONFIG_ERROR",
					message: `script for ${input} must be an object`,
				});
			}
			const executeScopeId = scriptRaw.executeScopeId;
			scripts[input] = {
				agentKind: requiredString(scriptRaw, "agentKind"),
				capability: requiredString(scriptRaw, "capability"),
				pithosPath: requiredString(scriptRaw, "pithosPath"),
				eventLogPath: requiredString(scriptRaw, "eventLogPath"),
				actions: parseActions(scriptRaw.actions, input),
				...(typeof executeScopeId === "string" ? { executeScopeId } : {}),
				hitl: scriptRaw.hitl === true,
			};
		}
	}

	return { responses, scripts };
};

const readConfig = (configPath: string, services: FagentServices): Config => {
	try {
		return parseConfig(JSON.parse(services.readText(configPath)));
	} catch (error) {
		if (error instanceof FagentError) throw error;
		throw new FagentError({
			code: "CONFIG_ERROR",
			message: `failed to load fagent config ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
		});
	}
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
	return [
		"READ_RESULT",
		...filePaths.map((filePath) => {
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
		}),
	].join("\n");
};

const parseOkJson = (text: string): Record<string, unknown> => {
	const raw = JSON.parse(text) as unknown;
	if (!isRecord(raw) || raw.ok !== true) {
		throw new FagentError({
			code: "SCRIPT_ERROR",
			message: `pithos returned unsuccessful JSON: ${text}`,
		});
	}
	return raw;
};

const event = (
	script: Script,
	appendText: (path: string, text: string) => void,
	runId: string,
	action: Action,
	taskId: string | undefined,
	outcome: "ok" | "error",
) => {
	appendText(
		script.eventLogPath,
		`${JSON.stringify({ run_id: runId, agent_kind: script.agentKind, action, task_id: taskId, outcome })}\n`,
	);
};

interface ScriptState {
	readonly runId: string;
	readonly scopeId: string;
	heldTaskId: string | undefined;
	token: string | undefined;
}

const requireScriptServices = (services: FagentServices) => {
	if (services.execFile === undefined) {
		throw new FagentError({
			code: "SCRIPT_ERROR",
			message: "scripted fagent requires execFile service",
		});
	}
	if (services.appendText === undefined) {
		throw new FagentError({
			code: "SCRIPT_ERROR",
			message: "scripted fagent requires appendText service",
		});
	}
	return { execFile: services.execFile, appendText: services.appendText };
};

const runAction = (
	script: Script,
	execFile: (file: string, args: readonly string[], input?: string) => string,
	state: ScriptState,
	action: Action,
): string => {
	if (action === "claim") {
		const json = parseOkJson(
			execFile(script.pithosPath, [
				"task",
				"claim",
				"--run",
				state.runId,
				"--scope",
				state.scopeId,
				"--capability",
				script.capability,
			]),
		);
		const task = json.task;
		if (!isRecord(task) || typeof task.id !== "string" || typeof task.token !== "number") {
			throw new FagentError({
				code: "SCRIPT_ERROR",
				message: "claim response missing task id or token",
			});
		}
		state.heldTaskId = task.id;
		state.token = String(task.token);
		return state.heldTaskId;
	}

	if (action === "enqueue_execute") {
		if (state.heldTaskId === undefined) {
			throw new FagentError({
				code: "SCRIPT_ERROR",
				message: "enqueue_execute requires a held task",
			});
		}
		if (script.executeScopeId === undefined) {
			throw new FagentError({
				code: "SCRIPT_ERROR",
				message: "enqueue_execute requires executeScopeId",
			});
		}
		const json = parseOkJson(
			execFile(
				script.pithosPath,
				[
					"task",
					"enqueue",
					"--run",
					state.runId,
					"--scope",
					script.executeScopeId,
					"--capability",
					"execute",
					"--title",
					"fagent execute",
					"--stdin",
				],
				"fagent execute task",
			),
		);
		const task = json.task;
		if (!isRecord(task) || typeof task.id !== "string") {
			throw new FagentError({ code: "SCRIPT_ERROR", message: "enqueue response missing task id" });
		}
		return task.id;
	}

	if (state.heldTaskId === undefined || state.token === undefined) {
		throw new FagentError({ code: "SCRIPT_ERROR", message: `${action} requires a held task` });
	}

	if (action === "fail_execute_once") {
		parseOkJson(
			execFile(script.pithosPath, [
				"task",
				"fail",
				"--run",
				state.runId,
				"--token",
				state.token,
				"--reason",
				"fagent deterministic first failure",
				state.heldTaskId,
			]),
		);
		return state.heldTaskId;
	}

	if (action === "repair_replay") {
		const inspect = parseOkJson(
			execFile(script.pithosPath, ["task", "inspect", "--json", state.heldTaskId]),
		);
		const source = inspect.source;
		if (!isRecord(source) || source.source_kind !== "repair" || typeof source.id !== "string") {
			throw new FagentError({ code: "SCRIPT_ERROR", message: "held task is not a Repair Alert" });
		}
		parseOkJson(
			execFile(script.pithosPath, [
				"task",
				"replay",
				"--run",
				state.runId,
				"--token",
				state.token,
				"--reason",
				"fagent replay",
				source.id,
			]),
		);
		return source.id;
	}

	parseOkJson(
		execFile(
			script.pithosPath,
			[
				"task",
				"complete",
				"--run",
				state.runId,
				"--token",
				state.token,
				"--stdin",
				state.heldTaskId,
			],
			"{}",
		),
	);
	return state.heldTaskId;
};

const runScript = (script: Script, services: FagentServices): string => {
	const env = services.env ?? {};
	const runId = env.PITHOS_RUN_ID;
	const scopeId = env.PITHOS_SCOPE_ID;
	if (!runId) {
		throw new FagentError({
			code: "SCRIPT_ERROR",
			message: "PITHOS_RUN_ID is required for scripted fagent",
		});
	}
	if (!scopeId) {
		throw new FagentError({
			code: "SCRIPT_ERROR",
			message: "PITHOS_SCOPE_ID is required for scripted fagent",
		});
	}
	const { execFile, appendText } = requireScriptServices(services);
	const state: ScriptState = { runId, scopeId, heldTaskId: undefined, token: undefined };

	for (const action of script.actions) {
		let taskId: string | undefined;
		let outcome: "ok" | "error" = "ok";
		try {
			taskId = runAction(script, execFile, state, action);
		} catch (error) {
			outcome = "error";
			throw error;
		} finally {
			event(script, appendText, runId, action, taskId, outcome);
		}
	}

	return script.hitl ? "FAGENT_HITL_READY" : "FAGENT_SCRIPT_DONE";
};

export const runFagent = (
	argv: readonly string[],
	cwd: string,
	services: FagentServices,
): string => {
	const { configPath, input } = parseStartup(argv);
	if (input.startsWith("READ ")) return readFiles(cwd, input, services);
	const config = readConfig(configPath, services);
	const script = config.scripts[input];
	if (script !== undefined) return runScript(script, services);
	const response = config.responses[input];
	if (response === undefined) {
		throw new FagentError({
			code: "NO_RESPONSE",
			message: `no configured fagent response for input: ${input}`,
		});
	}
	return response;
};
