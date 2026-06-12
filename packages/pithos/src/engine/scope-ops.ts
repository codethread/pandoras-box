import { Effect } from "effect";
import { resolve } from "node:path";
import { sql } from "../db.js";
import { fail } from "../errors.js";
import { withDb } from "./db-helpers.js";
import { requireNonEmpty } from "./guards.js";
import {
	parseScopeArchiveCheck,
	parseScopeIdentity,
	parseScopeOutput,
	toScopeOutput,
} from "./task-read-model.js";
import type { Engine, EngineContext, ScopeOutput } from "./types.js";

// Used when --description is omitted: preserves any existing description value.
const upsertScopePreserveDescription = sql`
INSERT INTO scopes(
	id,
	kind,
	canonical_path,
	parent_repo_path
) VALUES (?, ?, ?, ?)
ON CONFLICT(id)
DO UPDATE SET
	kind = excluded.kind,
	canonical_path = excluded.canonical_path,
	parent_repo_path = excluded.parent_repo_path,
	archived_at = NULL,
	updated_at = CURRENT_TIMESTAMP
RETURNING id, kind, canonical_path, parent_repo_path, archived_at, description
`;

// Used when --description is explicitly provided: sets or clears the description.
const upsertScopeSetDescription = sql`
INSERT INTO scopes(
	id,
	kind,
	canonical_path,
	parent_repo_path,
	description
) VALUES (?, ?, ?, ?, ?)
ON CONFLICT(id)
DO UPDATE SET
	kind = excluded.kind,
	canonical_path = excluded.canonical_path,
	parent_repo_path = excluded.parent_repo_path,
	description = excluded.description,
	archived_at = NULL,
	updated_at = CURRENT_TIMESTAMP
RETURNING id, kind, canonical_path, parent_repo_path, archived_at, description
`;

const scopePathMissing = (ctx: EngineContext, scope: ScopeOutput): boolean =>
	(scope.kind === "repo" || scope.kind === "worktree") &&
	scope.canonical_path !== null &&
	!Effect.runSync(ctx.services.fs.existsDirectory(scope.canonical_path));

export const makeScopeOps = (
	ctx: EngineContext,
): Pick<Engine, "scopeUpsert" | "scopeList" | "scopeArchive"> => ({
	scopeUpsert: ({ kind, path, parentRepoPath, description }) =>
		withDb(ctx, (db) => {
			if (!(["global", "repo", "worktree"] as const).includes(kind)) {
				fail("VALIDATION_ERROR", `invalid scope kind: ${kind}`);
			}

			const rawPath =
				kind === "global"
					? undefined
					: requireNonEmpty(path ?? fail("VALIDATION_ERROR", "missing --path"), "--path");
			const canonical = rawPath === undefined ? null : resolve(rawPath);
			if ((kind === "repo" || kind === "worktree") && canonical !== null) {
				const existsDirectory = Effect.runSync(ctx.services.fs.existsDirectory(canonical));
				if (!existsDirectory) {
					fail(
						"VALIDATION_ERROR",
						`${kind} scope path must exist as a directory before upsert: ${canonical}. Create the directory first, then upsert the scope.`,
					);
				}
			}
			const canonicalParentRepoPath =
				kind === "worktree"
					? resolve(
							requireNonEmpty(
								parentRepoPath ??
									fail("VALIDATION_ERROR", "missing --parent-repo for worktree scope"),
								"--parent-repo",
							),
						)
					: parentRepoPath === undefined
						? null
						: fail(
								"VALIDATION_ERROR",
								`--parent-repo is only valid for worktree scope upsert; got ${kind}`,
							);
			if (kind === "worktree") {
				const worktreeParentRepoPath =
					canonicalParentRepoPath ?? fail("INTERNAL_ERROR", "missing worktree parent repo path");
				const existsDirectory = Effect.runSync(
					ctx.services.fs.existsDirectory(worktreeParentRepoPath),
				);
				if (!existsDirectory) {
					fail(
						"VALIDATION_ERROR",
						`worktree parent repo path must exist as a directory before upsert: ${worktreeParentRepoPath}. Create or restore the parent repo directory first, then upsert the scope.`,
					);
				}
			}
			const sid = kind === "global" ? "global" : `${kind}:${canonical}`;
			const scopeRow = parseScopeIdentity(
				description !== undefined
					? db
							.prepare(upsertScopeSetDescription)
							.get(sid, kind, canonical, canonicalParentRepoPath, description)
					: db
							.prepare(upsertScopePreserveDescription)
							.get(sid, kind, canonical, canonicalParentRepoPath),
				`scope not found after upsert: ${sid}`,
			);
			return { ok: true, scope: scopeRow };
		}),
	scopeList: ({ all }) =>
		withDb(ctx, (db) => ({
			ok: true,
			scopes: db
				.prepare(sql`
					SELECT
						s.id,
						s.kind,
						s.canonical_path,
						s.parent_repo_path,
						s.archived_at,
						s.description,
						COUNT(DISTINCT t.id) AS task_count,
						COUNT(DISTINCT r.id) AS run_count
					FROM scopes s
					LEFT JOIN tasks t ON t.scope_id = s.id
					LEFT JOIN runs r ON r.scope_id = s.id
					${all ? "" : "WHERE s.archived_at IS NULL"}
					GROUP BY s.id, s.kind, s.canonical_path, s.parent_repo_path, s.archived_at, s.description
					ORDER BY s.archived_at IS NOT NULL ASC, s.kind ASC, s.canonical_path ASC, s.id ASC
				`)
				.all()
				.map((row) => parseScopeOutput(row, "malformed scope row"))
				.map((scope) => ({ ...scope, path_missing: scopePathMissing(ctx, scope) })),
		})),
	scopeArchive: ({ scopeId }) =>
		withDb(ctx, (db) =>
			db.transaction(
				(): {
					readonly ok: true;
					readonly action: "archived" | "deleted";
					readonly scope: ScopeOutput;
				} => {
					const scope = parseScopeArchiveCheck(
						db
							.prepare(sql`
						SELECT
							s.id,
							s.kind,
							s.canonical_path,
							s.parent_repo_path,
							s.archived_at,
							s.description,
							COUNT(DISTINCT t.id) AS task_count,
							COUNT(DISTINCT r.id) AS run_count,
							COUNT(DISTINCT CASE WHEN r.status = 'live' THEN r.id END) AS live_run_count,
							COUNT(DISTINCT CASE WHEN t.status IN ('queued', 'claimed', 'running') THEN t.id END) AS active_task_count
						FROM scopes s
						LEFT JOIN tasks t ON t.scope_id = s.id
						LEFT JOIN runs r ON r.scope_id = s.id
						WHERE s.id = ?
						GROUP BY s.id, s.kind, s.canonical_path, s.parent_repo_path, s.archived_at, s.description
					`)
							.get(scopeId),
						`scope not found: ${scopeId}`,
					);
					if (scope.kind === "global") {
						fail("VALIDATION_ERROR", "cannot archive built-in global scope");
					}
					if (scope.live_run_count > 0) {
						fail(
							"VALIDATION_ERROR",
							`scope ${scopeId} still has ${scope.live_run_count} live run(s)`,
						);
					}
					if (scope.active_task_count > 0) {
						fail(
							"VALIDATION_ERROR",
							`scope ${scopeId} still has ${scope.active_task_count} non-terminal task(s)`,
						);
					}
					if (scope.task_count === 0 && scope.run_count === 0) {
						const deleted = db.prepare(sql`DELETE FROM scopes WHERE id=?`).run(scopeId);
						if (deleted.changes === 0) fail("STALE_TOKEN_RACE", "scope changed before archive");
						const deletedScope = toScopeOutput(scope);
						return {
							ok: true,
							action: "deleted" as const,
							scope: {
								...deletedScope,
								path_missing: scopePathMissing(ctx, deletedScope),
							},
						};
					}
					const archivedScope = parseScopeIdentity(
						db
							.prepare(
								sql`UPDATE scopes SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING id, kind, canonical_path, parent_repo_path, archived_at, description`,
							)
							.get(scopeId),
						`scope not found after archive: ${scopeId}`,
					);
					const outputScope = {
						...archivedScope,
						task_count: scope.task_count,
						run_count: scope.run_count,
						path_missing: false,
					};
					return {
						ok: true,
						action: "archived" as const,
						scope: { ...outputScope, path_missing: scopePathMissing(ctx, outputScope) },
					};
				},
			)(),
		),
});
