import { Effect } from "effect";
import { sql } from "../db.js";
import { fail } from "../errors.js";
import { decodeRow, RunRowSchema, TaskRowSchema, type RunRow, type TaskRow } from "../rows.js";
import { withCollisionGuard, withDb } from "./db-helpers.js";
import { event } from "./event-log.js";
import {
	enforceActiveScope,
	parseHarnessKind,
	requireNonEmpty,
	runById,
	runSelect,
	scopeById,
	toRunOutput,
} from "./guards.js";
import { createRepairAlertInTxn } from "./repair-alerts.js";
import { taskSummarySelect } from "./task-read-model.js";
import type { Engine, EngineContext } from "./types.js";

const upsertRun = sql`
INSERT INTO runs(
	id,
	agent_kind,
	mode,
	scope_id,
	cwd,
	session_id,
	harness_kind,
	session_log_path
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id)
DO UPDATE SET
	agent_kind = excluded.agent_kind,
	mode = excluded.mode,
	scope_id = excluded.scope_id,
	cwd = excluded.cwd,
	session_id = excluded.session_id,
	harness_kind = excluded.harness_kind,
	session_log_path = excluded.session_log_path,
	status = 'live',
	updated_at = CURRENT_TIMESTAMP
`;

const insertRun = sql`
INSERT INTO runs(
	id,
	agent_kind,
	mode,
	scope_id,
	cwd,
	session_id,
	harness_kind,
	session_log_path
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

const terminalRunStatuses = ["ended", "failed", "cancelled", "timed_out"] as const;
const activeTaskStatuses = ["claimed", "running"] as const;
const terminalTaskStatuses = ["done", "failed", "dead_letter", "cancelled"] as const;

const runTerminalStatusForTask = (taskStatus: string): "ended" | "failed" =>
	taskStatus === "done" ? "ended" : "failed";

const nonEmptyRunCwd = (run: RunRow): string =>
	run.cwd ?? fail("INTERNAL_ERROR", `run ${run.id} is missing cwd`);

const renderDeadLetterSessionEvidence = (sessionEvidence: string | undefined): string => {
	const text =
		sessionEvidence?.trimEnd() ??
		"Session evidence unavailable: pdx did not capture transcript context before cleanup.";
	return ["```text", text, "```"].join("\n");
};

const deadLetterRepairAlertBody = (input: {
	readonly task: TaskRow;
	readonly run: RunRow;
	readonly reason: string;
	readonly sessionEvidence: string | undefined;
}): string =>
	[
		`Task ${input.task.id} exhausted its ${input.task.max_attempts} attempts and entered dead_letter state.`,
		"",
		"## Task",
		`- Task: ${input.task.id}`,
		`- Scope: ${input.task.scope_id}`,
		`- Capability: ${input.task.capability}`,
		`- Attempts exhausted: ${input.task.max_attempts}`,
		`- Reason: ${input.reason}`,
		"",
		"## Run context",
		`- Run: ${input.run.id}`,
		`- Agent: ${input.run.agent_kind}`,
		`- Mode: ${input.run.mode}`,
		`- Scope: ${input.run.scope_id}`,
		`- Cwd: ${nonEmptyRunCwd(input.run)}`,
		`- Harness: ${input.run.harness_kind}`,
		`- Harness session: ${input.run.session_id}`,
		`- Session log: ${input.run.session_log_path}`,
		"",
		"## Session evidence",
		renderDeadLetterSessionEvidence(input.sessionEvidence),
		"",
		"## Inspect",
		`- Durable run: \`pithos run inspect ${input.run.id}\``,
		`- Harness transcript: \`pdx run transcript ${input.run.id}\``,
		"- Supervisor logs: `pdx daemon logs --since 1h`",
		"",
		"Investigate the task history and decide whether to replay it with a fresh retry budget after fixing context/preconditions, supersede it if the work definition changed, replan, or accept the failure.",
	].join("\n");

export const makeRunLifecycleOps = (
	ctx: EngineContext,
): Pick<
	Engine,
	| "runUpsert"
	| "runInspect"
	| "activeRunForTask"
	| "runCleanup"
	| "runInterrupt"
	| "runTimeout"
	| "runLaunchAbort"
> => ({
	runUpsert: ({ agent, mode, scope, cwd, harnessKind, sessionLogPath, sessionId, runId }) =>
		withDb(ctx, (db) => {
			const agentExists = db
				.prepare(sql`SELECT 1 FROM agent_kinds WHERE agent_kind = ?`)
				.get(agent);
			if (agentExists === undefined) fail("VALIDATION_ERROR", `unknown agent kind: ${agent}`);

			enforceActiveScope(scopeById(db, scope));

			const callerProvidedId = runId !== undefined;
			const rid = requireNonEmpty(runId ?? Effect.runSync(ctx.services.ids.make("run")), "--run");
			const runArgs = [
				rid,
				agent,
				mode,
				scope,
				requireNonEmpty(cwd, "--cwd"),
				requireNonEmpty(sessionId, "--session-id"),
				parseHarnessKind(harnessKind),
				requireNonEmpty(sessionLogPath, "--session-log-path"),
			] as const;
			if (callerProvidedId) {
				// Caller-provided IDs use UPSERT for intentional re-registration (e.g. daemon restart).
				db.prepare(upsertRun).run(...runArgs);
			} else {
				// Engine-generated IDs use plain INSERT: collision means the word combination
				// was already taken, which must fail loudly rather than overwrite.
				withCollisionGuard(rid, () => db.prepare(insertRun).run(...runArgs));
			}
			const row = decodeRow(
				RunRowSchema,
				db.prepare(`${runSelect} WHERE id=?`).get(rid),
				`run not found after upsert: ${rid}`,
			);
			return { ok: true, run: toRunOutput(row) };
		}),
	runInspect: ({ runId }) =>
		withDb(ctx, (db) => ({ ok: true, run: toRunOutput(runById(db, runId)) })),
	activeRunForTask: ({ taskId }) =>
		withDb(ctx, (db) => {
			const run = db
				.prepare(
					sql`SELECT * FROM runs WHERE task_id=? AND status NOT IN ('ended','failed','cancelled','timed_out')`,
				)
				.get(taskId);
			return {
				ok: true,
				run: run === undefined ? null : toRunOutput(decodeRow(RunRowSchema, run, "active run")),
			};
		}),
	runCleanup: ({ runId, reason, sessionEvidence }) =>
		withDb(ctx, (db) => {
			const nonEmptyReason = requireNonEmpty(reason, "--reason");
			const finalRun: RunRow = db.transaction((): RunRow => {
				const run = runById(db, runId);
				if (terminalRunStatuses.includes(run.status as (typeof terminalRunStatuses)[number])) {
					return run;
				}
				if (run.task_id === null) {
					const runUpdate = db
						.prepare(
							sql`UPDATE runs SET status='ended', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=? AND task_id IS NULL`,
						)
						.run(run.id, run.status);
					if (runUpdate.changes === 0)
						fail("STALE_TOKEN_RACE", "cleanup run snapshot changed before update");
					event(ctx, db, "run.cleanup", {
						run_id: run.id,
						payload: { reason: nonEmptyReason, previous_status: run.status, status: "ended" },
					});
					return runById(db, run.id);
				}
				const task = decodeRow(
					TaskRowSchema,
					db.prepare(`${taskSummarySelect} WHERE t.id=?`).get(run.task_id),
					`task not found: ${run.task_id}`,
				);
				if (terminalTaskStatuses.includes(task.status as (typeof terminalTaskStatuses)[number])) {
					const status = runTerminalStatusForTask(task.status);
					const runUpdate = db
						.prepare(
							sql`UPDATE runs SET status=?, task_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=? AND task_id=?`,
						)
						.run(status, run.id, run.status, task.id);
					if (runUpdate.changes === 0)
						fail("STALE_TOKEN_RACE", "cleanup run snapshot changed before update");
					event(ctx, db, "run.cleanup", {
						run_id: run.id,
						payload: {
							reason: nonEmptyReason,
							previous_status: run.status,
							status,
							task_id: task.id,
						},
					});
					return runById(db, run.id);
				}
				if (!activeTaskStatuses.includes(task.status as (typeof activeTaskStatuses)[number])) {
					fail("INTERNAL_ERROR", `unsupported held task status: ${task.status}`);
				}
				const nextTaskStatus = task.attempts < task.max_attempts ? "queued" : "dead_letter";
				const taskUpdate = db
					.prepare(
						nextTaskStatus === "dead_letter"
							? sql`
						UPDATE tasks
						SET status=?, fencing_token=fencing_token + 1, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
						WHERE id=? AND status=? AND fencing_token=?
					`
							: sql`
						UPDATE tasks
						SET status=?, fencing_token=fencing_token + 1, updated_at=CURRENT_TIMESTAMP
						WHERE id=? AND status=? AND fencing_token=?
					`,
					)
					.run(nextTaskStatus, task.id, task.status, task.fencing_token);
				if (taskUpdate.changes === 0)
					fail("STALE_TOKEN_RACE", "cleanup active task snapshot changed before update");
				const runUpdate = db
					.prepare(
						sql`UPDATE runs SET status='failed', task_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=? AND task_id=?`,
					)
					.run(run.id, run.status, task.id);
				if (runUpdate.changes === 0)
					fail("STALE_TOKEN_RACE", "cleanup run snapshot changed before update");
				const taskEventType = nextTaskStatus === "queued" ? "task.reclaimed" : "task.dead_lettered";
				event(ctx, db, taskEventType, {
					task_id: task.id,
					run_id: run.id,
					payload: {
						previous_run_id: run.id,
						reason: nonEmptyReason,
						attempts: task.attempts,
						max_attempts: task.max_attempts,
						previous_fencing_token: task.fencing_token,
						new_fencing_token: task.fencing_token + 1,
					},
				});
				event(ctx, db, "run.cleanup", {
					run_id: run.id,
					payload: {
						reason: nonEmptyReason,
						previous_status: run.status,
						status: "failed",
						task_id: task.id,
					},
				});
				if (nextTaskStatus === "dead_letter") {
					createRepairAlertInTxn(ctx, db, {
						kind: "dead_letter",
						affectedTaskId: task.id,
						escalationTitle: `Investigate dead-lettered task ${task.id}`,
						escalationBody: deadLetterRepairAlertBody({
							task,
							run,
							reason: nonEmptyReason,
							sessionEvidence,
						}),
					});
				}
				return runById(db, run.id);
			})();
			return { ok: true, run: toRunOutput(finalRun) };
		}),
	runInterrupt: ({ runId, taskId, reason, expectedRunId }) =>
		withDb(ctx, (db) => {
			const nonEmptyReason = requireNonEmpty(reason, "--reason");
			if ((runId === undefined) === (taskId === undefined)) {
				fail("VALIDATION_ERROR", "provide exactly one of --run or --task");
			}
			const result = db.transaction(
				(): {
					readonly run: RunRow;
					readonly interruptedTask: { readonly id: string; readonly scope_id: string } | null;
				} => {
					const resolvedRunId =
						runId ??
						(db
							.prepare(
								sql`SELECT id FROM runs WHERE task_id=? AND status NOT IN ('ended','failed','cancelled','timed_out')`,
							)
							.pluck()
							.get(taskId) as string | undefined) ??
						fail("NOT_FOUND", `no active run holds task: ${taskId}`);
					if (expectedRunId !== undefined && resolvedRunId !== expectedRunId) {
						fail("STALE_TOKEN_RACE", "interrupt task owner changed before supervisor kill");
					}
					const run = runById(db, resolvedRunId);
					if (taskId !== undefined && run.task_id !== taskId) {
						fail("STALE_TOKEN_RACE", "interrupt task owner changed before update");
					}
					if (terminalRunStatuses.includes(run.status as (typeof terminalRunStatuses)[number])) {
						return { run, interruptedTask: null };
					}
					if (run.task_id === null) {
						const runUpdate = db
							.prepare(
								sql`UPDATE runs SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=? AND task_id IS NULL`,
							)
							.run(run.id, run.status);
						if (runUpdate.changes === 0)
							fail("STALE_TOKEN_RACE", "interrupt run snapshot changed before update");
						event(ctx, db, "run.interrupted", {
							run_id: run.id,
							payload: { reason: nonEmptyReason, previous_status: run.status, status: "cancelled" },
						});
						return { run: runById(db, run.id), interruptedTask: null };
					}
					const task = decodeRow(
						TaskRowSchema,
						db.prepare(`${taskSummarySelect} WHERE t.id=?`).get(run.task_id),
						`task not found: ${run.task_id}`,
					);
					if (activeTaskStatuses.includes(task.status as (typeof activeTaskStatuses)[number])) {
						const taskUpdate = db
							.prepare(
								sql`
							UPDATE tasks
							SET status='failed', fencing_token=fencing_token + 1, updated_at=CURRENT_TIMESTAMP, completed_at=CURRENT_TIMESTAMP, result_json=?
							WHERE id=? AND status=? AND fencing_token=?
						`,
							)
							.run(
								JSON.stringify({ reason: nonEmptyReason }),
								task.id,
								task.status,
								task.fencing_token,
							);
						if (taskUpdate.changes === 0)
							fail("STALE_TOKEN_RACE", "interrupt active task snapshot changed before update");
						const runUpdate = db
							.prepare(
								sql`UPDATE runs SET status='failed', task_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=? AND task_id=?`,
							)
							.run(run.id, run.status, task.id);
						if (runUpdate.changes === 0)
							fail("STALE_TOKEN_RACE", "interrupt run snapshot changed before update");
						event(ctx, db, "task.interrupted", {
							task_id: task.id,
							run_id: run.id,
							payload: {
								run_id: run.id,
								reason: nonEmptyReason,
								previous_status: task.status,
								previous_fencing_token: task.fencing_token,
								new_fencing_token: task.fencing_token + 1,
							},
						});
						event(ctx, db, "run.interrupted", {
							run_id: run.id,
							payload: {
								reason: nonEmptyReason,
								previous_status: run.status,
								status: "failed",
								task_id: task.id,
							},
						});
						createRepairAlertInTxn(ctx, db, {
							kind: "interrupt",
							affectedTaskId: task.id,
							escalationTitle: `Investigate interrupted task ${task.id}`,
							escalationBody: `Task ${task.id} was interrupted while held by run ${run.id} (scope: ${task.scope_id}, capability: ${task.capability}).\n\nReason: ${nonEmptyReason}\n\nInvestigate the task and decide whether to replay it after fixing context/preconditions, supersede it if the work definition changed, replan, or accept the failure.`,
						});
						return {
							run: runById(db, run.id),
							interruptedTask: { id: task.id, scope_id: task.scope_id },
						};
					}
					if (terminalTaskStatuses.includes(task.status as (typeof terminalTaskStatuses)[number])) {
						const status = runTerminalStatusForTask(task.status);
						const runUpdate = db
							.prepare(
								sql`UPDATE runs SET status=?, task_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=? AND task_id=?`,
							)
							.run(status, run.id, run.status, task.id);
						if (runUpdate.changes === 0)
							fail("STALE_TOKEN_RACE", "interrupt run snapshot changed before update");
						event(ctx, db, "run.interrupted", {
							run_id: run.id,
							payload: {
								reason: nonEmptyReason,
								previous_status: run.status,
								status,
								task_id: task.id,
							},
						});
						return { run: runById(db, run.id), interruptedTask: null };
					}
					return fail("INTERNAL_ERROR", `unsupported held task status: ${task.status}`);
				},
			)();
			return {
				ok: true,
				run: toRunOutput(result.run),
				interrupted_task: result.interruptedTask,
			};
		}),
	runTimeout: ({ runId, reason }) =>
		withDb(ctx, (db) => {
			const nonEmptyReason = requireNonEmpty(reason, "--reason");
			const finalRun: RunRow = db.transaction((): RunRow => {
				const run = runById(db, runId);
				if (run.task_id !== null) fail("VALIDATION_ERROR", "run timeout requires no held task");
				if (terminalRunStatuses.includes(run.status as (typeof terminalRunStatuses)[number])) {
					return run;
				}
				if (run.agent_kind === "pandora" || run.agent_kind === "pdx") {
					fail("VALIDATION_ERROR", `run timeout is not valid for ${run.agent_kind}`);
				}
				if (run.has_claimed_task !== 0) {
					fail("VALIDATION_ERROR", "run timeout requires a run that has never claimed a task");
				}
				const runUpdate = db
					.prepare(
						sql`UPDATE runs SET status='timed_out', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=? AND task_id IS NULL`,
					)
					.run(run.id, run.status);
				if (runUpdate.changes === 0)
					fail("STALE_TOKEN_RACE", "timeout run snapshot changed before update");
				event(ctx, db, "run.timed_out", {
					run_id: run.id,
					payload: { reason: nonEmptyReason, previous_status: run.status, status: "timed_out" },
				});
				return runById(db, run.id);
			})();
			return { ok: true, run: toRunOutput(finalRun) };
		}),
	runLaunchAbort: ({ runId, reason }) =>
		withDb(ctx, (db) => {
			const nonEmptyReason = requireNonEmpty(reason, "--reason");
			const finalRun: RunRow = db.transaction((): RunRow => {
				const run = runById(db, runId);
				if (run.status !== "live") {
					fail("VALIDATION_ERROR", "launch abort requires a live run");
				}
				if (run.task_id !== null) {
					fail("VALIDATION_ERROR", "launch abort requires no held task");
				}
				if (run.has_claimed_task !== 0) {
					fail("VALIDATION_ERROR", "launch abort requires a run that has never claimed a task");
				}
				const runUpdate = db
					.prepare(
						sql`UPDATE runs SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='live' AND task_id IS NULL`,
					)
					.run(run.id);
				if (runUpdate.changes === 0) {
					fail("STALE_TOKEN_RACE", "launch abort run snapshot changed before update");
				}
				event(ctx, db, "run.launch_aborted", {
					run_id: run.id,
					payload: { reason: nonEmptyReason, previous_status: run.status, status: "cancelled" },
				});
				return runById(db, run.id);
			})();
			return { ok: true, run: toRunOutput(finalRun) };
		}),
});
