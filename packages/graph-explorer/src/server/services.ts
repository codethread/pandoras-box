import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { createConnection } from "node:net";

import { GraphExplorerError } from "../errors.js";

export interface ServerServices {
	readonly clock: {
		readonly nowIso: () => string;
	};
	readonly fileSystem: {
		readonly fileExists: (path: string) => Promise<boolean>;
		readonly readTextFile: (path: string) => Promise<string>;
	};
	readonly socket: {
		readonly requestJson: (socketPath: string, request: unknown) => Promise<unknown>;
	};
}

const parseSocketJson = (socketPath: string, output: string): unknown => {
	const trimmed = output.trim();
	if (trimmed.length === 0) {
		throw new GraphExplorerError({
			code: "INTERNAL_ERROR",
			message: `Socket '${socketPath}' returned an empty response`,
		});
	}

	try {
		return JSON.parse(trimmed) as unknown;
	} catch (error) {
		throw new GraphExplorerError({
			code: "INTERNAL_ERROR",
			message:
				error instanceof Error
					? `Socket '${socketPath}' returned invalid JSON: ${error.message}`
					: `Socket '${socketPath}' returned invalid JSON`,
		});
	}
};

export const liveServerServices: ServerServices = {
	clock: {
		nowIso: () => new Date().toISOString(),
	},
	fileSystem: {
		fileExists: async (path) => {
			try {
				await access(path, constants.F_OK);
				return true;
			} catch {
				return false;
			}
		},
		readTextFile: async (path) => readFile(path, "utf8"),
	},
	socket: {
		requestJson: (socketPath, request) =>
			new Promise((resolve, reject) => {
				const socket = createConnection(socketPath);
				let output = "";
				socket.setEncoding("utf8");
				socket.setTimeout(1_000, () => {
					socket.destroy(
						new GraphExplorerError({
							code: "INTERNAL_ERROR",
							message: `Socket '${socketPath}' timed out waiting for a response`,
						}),
					);
				});
				socket.once("error", (error) => reject(error));
				socket.on("data", (chunk: string) => {
					output += chunk;
				});
				socket.on("end", () => {
					try {
						resolve(parseSocketJson(socketPath, output));
					} catch (error) {
						reject(error instanceof Error ? error : new Error(String(error)));
					}
				});
				socket.end(JSON.stringify(request));
			}),
	},
};
