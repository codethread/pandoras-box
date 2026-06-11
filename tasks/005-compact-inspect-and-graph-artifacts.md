# Task 5: Compact inspect and graph artifacts

## Scope

Type: AFK

Update task and graph inspection so primary views show the current active artifact set concisely, with full bodies available only through explicit detail surfaces.

## Must implement exactly

- Make task inspect Markdown default render active artifact refs only: artifact id, kind, and title.
- Add `pithos task inspect <task-id> --full` to render active artifact bodies inline using the existing concise embedded artifact format.
- Reject `--full --json` with a tagged validation error.
- Keep `task inspect --json` structured output, but include active artifacts only.
- Ensure lineage artifacts in `task inspect --json` are active-only.
- Update graph inspect text and JSON to use active artifact refs only.
- Remove `artifacts: none` lines from readable graph output.
- Keep non-empty graph artifact refs visible with artifact id, kind, and title.

## Done when

- Default `task inspect` does not render artifact bodies.
- `task inspect --full` renders active artifact bodies.
- Rejected artifacts are absent from task inspect, task inspect JSON, lineage artifacts, graph text, and graph JSON.
- `graph inspect` no longer emits empty artifact blocks.
- Existing render snapshots are updated intentionally.
- `pnpm --filter @pdx/pithos test` passes.
- `pnpm --filter @pdx/spawner test` passes or the task documents why command-card rendering was unaffected by the inspect/help change.

## Out of scope

- Extending artifact list/show/reject behavior from Task 4; consume its active/rejected artifact read model instead.
- Required-artifact missing status in graph; that is added with completion enforcement.
- Changing task body rendering.

## References

- `specs/artifact-contracts.md` section 8.
- `specs/task-graph.md` inspection surfaces.
- `packages/pithos/src/engine/render.ts`.
- `packages/pithos/src/engine/task-read-model.ts`.
- `packages/pithos/src/engine/graph-inspect.ts`.
- `packages/pithos/src/cli.ts`.
- `packages/pithos/test/render.test.ts`.
