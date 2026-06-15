import { resolve } from "node:path";

import type { ServerServices } from "./services.js";

export type DaemonStatusSnapshot =
	| {
			readonly status: "running";
			readonly socketPath: string;
			readonly maxAfk: number;
			readonly afkUsed: number;
			readonly registryEntries: number;
			readonly intakeSocketPath: string | null;
			readonly message: string;
	  }
	| {
			readonly status: "not_running";
			readonly socketPath: string;
			readonly message: string;
	  }
	| {
			readonly status: "unreachable";
			readonly socketPath: string;
			readonly message: string;
	  };

interface IpcStatusResponse {
	readonly ok: boolean;
	readonly data: Record<string, unknown> | undefined;
	readonly error: string | undefined;
}

const parseIpcStatusResponse = (value: unknown): IpcStatusResponse | null => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}

	const response = value as Record<string, unknown>;
	if (typeof response.ok !== "boolean") {
		return null;
	}
	if (
		response.data !== undefined &&
		(response.data === null || typeof response.data !== "object" || Array.isArray(response.data))
	) {
		return null;
	}
	if (response.error !== undefined && typeof response.error !== "string") {
		return null;
	}

	return {
		ok: response.ok,
		data: response.data === undefined ? undefined : (response.data as Record<string, unknown>),
		error: response.error,
	};
};

export const readDaemonStatus = async (
	pdxDataDir: string,
	services: ServerServices,
): Promise<DaemonStatusSnapshot> => {
	const socketPath = resolve(pdxDataDir, "pdx.sock");
	const socketExists = await services.fileSystem.fileExists(socketPath);

	if (!socketExists) {
		return {
			status: "not_running",
			socketPath,
			message: "No pdx daemon socket is present for this data dir.",
		};
	}

	try {
		const rawResponse = await services.socket.requestJson(socketPath, { kind: "status" });
		const response = parseIpcStatusResponse(rawResponse);
		if (response === null) {
			return {
				status: "unreachable",
				socketPath,
				message: "Daemon socket returned an invalid status response.",
			};
		}
		if (!response.ok) {
			return {
				status: "unreachable",
				socketPath,
				message: response.error ?? "Daemon status request failed.",
			};
		}

		const maxAfk = response.data?.max_afk;
		const registryEntries = response.data?.registry_entries;
		const intakeSocketPath = response.data?.intake_socket;
		if (
			typeof maxAfk !== "number" ||
			!Array.isArray(registryEntries) ||
			(intakeSocketPath !== undefined &&
				intakeSocketPath !== null &&
				typeof intakeSocketPath !== "string")
		) {
			return {
				status: "unreachable",
				socketPath,
				message: "Daemon status response is missing registry or AFK capacity details.",
			};
		}

		const afkUsed = registryEntries.filter(
			(entry) =>
				entry !== null && typeof entry === "object" && (entry as { mode?: unknown }).mode === "afk",
		).length;

		return {
			status: "running",
			socketPath,
			maxAfk,
			afkUsed,
			registryEntries: registryEntries.length,
			intakeSocketPath: intakeSocketPath ?? null,
			message: "pdx daemon status is reachable.",
		};
	} catch (error) {
		return {
			status: "unreachable",
			socketPath,
			message: error instanceof Error ? error.message : "Daemon socket request failed.",
		};
	}
};
