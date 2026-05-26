# Task 14: Add claim sequence counter

## Scope

Type: AFK

Add the monotonic per-Task `claim_sequence` counter and wire it through ordinary claim behavior without changing gate-release identity yet. This establishes the new audit counter while keeping this slice narrow and independently verifiable.

## Must implement exactly

- Add `tasks.claim_sequence INTEGER NOT NULL DEFAULT 0` to the fresh schema with no legacy compatibility or migration rebuild path.
- Update Task row decoding and Task detail/JSON output as needed so the new field is available at the Engine boundary.
- Update the claim transition so every successful claim increments `attempts`, `claim_sequence`, and `fencing_token` in one fenced update.
- Keep `attempts` as the dead-letter budget counter used against `max_attempts`; do not change cleanup retry policy.
- Keep existing gate-release PK/FK identity on `attempt` in this task; the next task moves gate releases to `claim_sequence`.

## Done when

- Tests prove a successful claim increments both `attempts` and `claim_sequence` from zero to one.
- Tests prove cleanup/dead-letter logic still uses `attempts` versus `max_attempts`, not `claim_sequence`.
- Existing Pithos lifecycle tests pass without changing gate-release behavior.
- Pithos typecheck and relevant Pithos tests pass.

## Out of scope

- Do not implement `pithos task replay`.
- Do not change gate-release or late-growth identity yet.
- Do not update Pandora prompt guidance.
- Do not write legacy migrations for existing databases; this alpha change assumes DB recreation.
- Do not fold the change spec into `specs/task-graph.md` yet.

## References

- `specs/task-replay.md`
- `specs/task-graph.md`
- `packages/pithos/src/db.ts`
- `packages/pithos/src/rows.ts`
- `packages/pithos/src/engine/claim-loop.ts`
- `packages/pithos/src/engine.ts`
- `packages/pithos/src/engine/task-read-model.ts`
- `packages/pithos/test/task-lifecycle.test.ts`
