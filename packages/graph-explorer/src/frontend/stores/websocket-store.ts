export type WebsocketConnectionStatus =
	| "connecting"
	| "connected"
	| "reconnecting"
	| "disconnected"
	| "error";

export interface WebsocketViewState {
	readonly status: WebsocketConnectionStatus;
	readonly lastMessageAt: string | null;
	readonly lastError: string | null;
	readonly reconnectAttempt: number;
}

export interface FreshnessState {
	readonly status: "empty" | "fresh" | "stale";
	readonly ageMs: number | null;
	readonly label: string;
}

export const disconnectedWebsocketState: WebsocketViewState = {
	status: "disconnected",
	lastMessageAt: null,
	lastError: null,
	reconnectAttempt: 0,
};

export const computeFreshnessState = (
	lastGraphUpdateAt: string | null,
	nowIso: string,
	refreshIntervalSeconds: number,
): FreshnessState => {
	if (lastGraphUpdateAt === null) {
		return { status: "empty", ageMs: null, label: "Waiting for first snapshot" };
	}
	const lastDate = new Date(lastGraphUpdateAt);
	const nowDate = new Date(nowIso);
	if (Number.isNaN(lastDate.getTime()) || Number.isNaN(nowDate.getTime())) {
		return { status: "stale", ageMs: null, label: "Latest snapshot timestamp is invalid" };
	}
	const ageMs = Math.max(0, nowDate.getTime() - lastDate.getTime());
	const staleAfterMs = Math.max(refreshIntervalSeconds * 2_000, 45_000);
	if (ageMs > staleAfterMs) {
		return {
			status: "stale",
			ageMs,
			label: `Snapshot is stale (${String(Math.round(ageMs / 1_000))}s old)`,
		};
	}
	return {
		status: "fresh",
		ageMs,
		label: `Snapshot fresh (${String(Math.round(ageMs / 1_000))}s old)`,
	};
};
