import { Effect, Either, Schema } from "effect";
import { sql, type Capability, type HarnessKind } from "../db.js";
import type { Db } from "../db.js";
import { fail } from "../errors.js";
import { decodeRow, RunRowSchema, ScopeRowSchema, type RunRow, type ScopeRow } from "../rows.js";
import type { EngineContext, RunOutput } from "./types.js";

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

export const scopeSelect = sql`
SELECT id, kind, canonical_path, parent_repo_path, archived_at, description
FROM scopes
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

const HarnessKindSchema = Schema.Literal("claude", "pi", "system");

export const parseHarnessKind = (value: unknown): HarnessKind =>
	Either.match(Schema.decodeUnknownEither(HarnessKindSchema)(value), {
		onLeft: () =>
			fail(
				"VALIDATION_ERROR",
				`invalid --harness-kind: ${String(value)}. Valid values: claude, pi, system`,
			),
		onRight: (kind) => kind,
	});

export const requireNonEmpty = (value: string, name: string): string => {
	if (value.length === 0) fail("VALIDATION_ERROR", `${name} must be non-empty`);
	return value;
};

export const resolveRunId = (ctx: EngineContext, explicit: string | undefined): string => {
	const env = ctx.config.runId;
	if (explicit !== undefined && env !== undefined && explicit !== env) {
		fail("VALIDATION_ERROR", "--run conflicts with PITHOS_RUN_ID");
	}
	return requireNonEmpty(explicit ?? env ?? fail("VALIDATION_ERROR", "missing --run"), "--run");
};

export const resolveBody = (
	ctx: EngineContext,
	body: string | undefined,
	bodyFile: string | undefined,
): string => {
	if (body !== undefined && bodyFile !== undefined) {
		fail("VALIDATION_ERROR", "provide only one of --body or --body-file");
	}
	const value =
		body ??
		(bodyFile === undefined ? undefined : Effect.runSync(ctx.services.fs.readText(bodyFile)));
	return requireNonEmpty(
		value ?? fail("VALIDATION_ERROR", "missing --body or --body-file"),
		"body",
	);
};

export const liveRun = (db: Db, runId: string): RunRow => {
	const r = decodeRow(
		RunRowSchema,
		db.prepare(`${runSelect} WHERE id=?`).get(runId),
		`run not found: ${runId}`,
	);
	if (r.status !== "live") fail("VALIDATION_ERROR", `run is not live: ${runId}`);
	return r;
};

export const runById = (db: Db, runId: string): RunRow =>
	decodeRow(
		RunRowSchema,
		db.prepare(`${runSelect} WHERE id=?`).get(runId),
		`run not found: ${runId}`,
	);

export const scopeById = (db: Db, scopeId: string): ScopeRow =>
	decodeRow(
		ScopeRowSchema,
		db.prepare(`${scopeSelect} WHERE id=?`).get(scopeId),
		`scope not found: ${scopeId}`,
	);

export const enforceActiveScope = (scope: ScopeRow): void => {
	if (scope.archived_at !== null) {
		fail("VALIDATION_ERROR", `scope is archived: ${scope.id}`);
	}
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

export const scopeForCapability = (db: Db, scopeId: string, cap: Capability): ScopeRow => {
	const s = scopeById(db, scopeId);
	enforceActiveScope(s);

	if (cap === "escalate" && s.kind !== "global") {
		fail("VALIDATION_ERROR", `escalate requires global scope; got ${scopeId}`);
	}

	if (cap === "intake" && s.kind !== "global") {
		fail("VALIDATION_ERROR", `intake requires global scope; got ${scopeId}`);
	}

	if (
		cap === "execute" &&
		!((s.kind === "repo" || s.kind === "worktree") && s.canonical_path !== null)
	) {
		fail(
			"VALIDATION_ERROR",
			`execute requires repo/worktree scope with canonical_path; got ${scopeId} kind=${s.kind}`,
		);
	}
	if (cap === "execute" && s.kind === "worktree" && s.parent_repo_path === null) {
		fail(
			"VALIDATION_ERROR",
			`execute requires worktree scope with parent_repo_path; got ${scopeId}`,
		);
	}

	return s;
};

export const enforceTaskAdmissionScope = (
	ctx: EngineContext,
	db: Db,
	scopeId: string,
	cap: Capability,
): void => {
	const s = scopeForCapability(db, scopeId, cap);
	if (s.kind === "global") return;
	const canonicalPath =
		s.canonical_path ??
		fail("INTERNAL_ERROR", `${s.kind} scope ${scopeId} is missing canonical_path`);
	const existsDirectory = Effect.runSync(ctx.services.fs.existsDirectory(canonicalPath));
	if (!existsDirectory) {
		fail(
			"VALIDATION_ERROR",
			`${s.kind} scope path is missing or not a directory: ${canonicalPath}. Create or restore the directory, then run \`pithos scope upsert --kind ${s.kind} --path ${canonicalPath}\`.`,
		);
	}
};

export const enforceCapScope = (db: Db, scopeId: string, cap: Capability): void => {
	void scopeForCapability(db, scopeId, cap);
};
