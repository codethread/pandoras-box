# Task 3: Harden artifact add ownership

## Scope

Type: AFK

Make artifact addition a fenced active-task-owner mutation and normalize its output metadata, while preserving optional empty artifact bodies.

## Must implement exactly

- Change `pithos task artifact add` to require `--token <token>`.
- Validate the target task is `claimed` or `running`.
- Validate the resolved Run is live, holds the target task, and the provided fencing token matches.
- Enforce lower-snake-case artifact `kind` for every artifact add.
- Preserve current body behavior: `--stdin` reads body; omitted `--stdin` stores an empty body.
- Return compact artifact metadata without body: id, task id, run id, kind, title, status, created timestamp.
- Keep `task.artifact_added` event emission.
- Update help JSON, command annotations, and tests for the new token requirement and output shape.

## Done when

- A live non-owner Run cannot add an artifact to another Run's held task.
- A stale token cannot add an artifact.
- Queued, done, failed, cancelled, and dead-lettered tasks reject artifact add.
- Bad artifact kinds fail loudly.
- Empty artifact bodies are still allowed when `--stdin` is omitted.
- `pnpm --filter @pdx/pithos test` passes.
- `pnpm --filter @pdx/spawner test` passes or the task documents why command-card rendering was unaffected by the help JSON change.

## Out of scope

- Artifact rejection.
- Artifact Contract completion enforcement.
- Changing artifact body emptiness semantics.
- Prompt rendering.

## References

- `specs/artifact-contracts.md` sections 6 and 7.
- `specs/task-graph.md` payload CLI contract.
- `packages/pithos/src/engine/claim-loop.ts`.
- `packages/pithos/src/cli.ts`.
- `packages/pithos/test/cli.test.ts`.
- `packages/pithos/test/task-lifecycle.test.ts`.
