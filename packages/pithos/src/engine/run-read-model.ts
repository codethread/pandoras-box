import type { Capability, Db } from "../db.js";
import { sql } from "../db.js";
import { fail } from "../errors.js";
import { decodeRow, RunRowSchema, type RunRow } from "../rows.js";
import type { RunOutput } from "./types.js";

export const runSelect = sql`
SELECT
	id,
	agent_kind,
	mode,
	scope_id,
	cwd,
	harness_kind,
	session_log_path,
	status,
	task_id,
	has_claimed_task,
	session_id,
	created_at,
	updated_at
FROM runs
`;

export const toRunOutput = (row: RunRow): RunOutput => ({
	id: row.id,
	agent: row.agent_kind,
	mode: row.mode,
	scope_id: row.scope_id,
	status: row.status,
	task_id: row.task_id,
	has_claimed_task: row.has_claimed_task === 1,
	session_id: row.session_id,
	harness_kind: row.harness_kind,
	session_log_path: row.session_log_path,
	created_at: row.created_at,
	updated_at: row.updated_at,
});

export const runById = (db: Db, runId: string): RunRow =>
	decodeRow(
		RunRowSchema,
		db.prepare(`${runSelect} WHERE id=?`).get(runId),
		`run not found: ${runId}`,
	);

export const liveRun = (db: Db, runId: string): RunRow => {
	const r = runById(db, runId);
	if (r.status !== "live") fail("VALIDATION_ERROR", `run is not live: ${runId}`);
	return r;
};

export const authorized = (
	db: Db,
	table: "agent_claims" | "agent_enqueues",
	runId: string,
	cap: Capability,
): RunRow => {
	const r = liveRun(db, runId);

	const tableName = table === "agent_claims" ? "agent_claims" : "agent_enqueues";
	const isAuthorized = db
		.prepare(
			sql`
			SELECT 1
			FROM ${tableName}
			WHERE agent_kind = ?
			  AND capability = ?
			`,
		)
		.get(r.agent_kind, cap);
	if (isAuthorized === undefined)
		fail("VALIDATION_ERROR", `${r.agent_kind} is not authorized for ${cap}`);

	return r;
};
