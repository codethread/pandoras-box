# Task 4: Add artifact rejection APIs

## Scope

Type: AFK

Add active/rejected artifact status, fenced artifact rejection, and targeted artifact list/show APIs. This establishes the audit/detail artifact surface without changing task/graph inspect rendering yet.

## Must implement exactly

- Migrate artifacts to include `status = active | rejected` plus rejection metadata fields: rejected timestamp, rejecting run id, rejection reason.
- Existing artifacts migrate as `active`.
- Enforce schema-level integrity for valid status values and rejection metadata consistency: active artifacts must not carry rejection metadata, and rejected artifacts must carry rejection timestamp, rejecting run id, and non-empty reason.
- Add `pithos task artifact reject <artifact-id> [--run <run-id>] --token <token> --reason <reason>`.
- Resolve parent task from artifact id; require active held-task ownership and matching token.
- Rejecting an already rejected artifact fails loudly.
- Emit `task.artifact_rejected` with artifact id, kind, and reason.
- Add `pithos task artifact list <task-id> [--json]` showing active and rejected artifact metadata, without bodies.
- Add `pithos task artifact show <artifact-id> [--json]` showing any artifact by exact id, including rejected artifacts; text output uses a heading, pretty fenced JSON metadata, and fenced Markdown body.
- Mutation outputs return compact artifact metadata without body; `show --json` includes body.

## Done when

- Rejection status and metadata persist in SQLite and parse through row schemas.
- Tests prove invalid artifact status and inconsistent rejection metadata cannot persist silently.
- Rejected artifacts appear in `artifact list` and exact-id `artifact show`.
- `artifact list` omits bodies in text and JSON.
- Rejection requires valid active ownership and token.
- Artifact rejection is one-way; no reactivation command exists.
- `pnpm --filter @pdx/pithos test` passes.
- `pnpm --filter @pdx/spawner test` passes or the task documents why command-card rendering was unaffected by the new help JSON commands.

## Out of scope

- Removing rejected artifacts from task/graph inspect views.
- Required-artifact completion enforcement.
- Hard deletion of artifacts.
- Reopening or reactivating rejected artifacts.

## References

- `specs/artifact-contracts.md` sections 6 and 7.
- `packages/pithos/src/db.ts`.
- `packages/pithos/src/rows.ts`.
- `packages/pithos/src/engine/task-read-model.ts`.
- `packages/pithos/src/engine/render.ts`.
- `packages/pithos/src/cli.ts`.
