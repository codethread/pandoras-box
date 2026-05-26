# Task 15: Key gate releases by sequence

## Scope

Type: AFK

Move gate-release audit identity from retry-cycle `attempt` to lifetime `claim_sequence`, preserving `attempt` as descriptive retry-cycle metadata. This completes the identity split needed before replay can reset attempts safely.

## Must implement exactly

- Store both `claim_sequence` and `attempt` on `task_gate_releases`.
- Change `task_gate_releases` primary identity to `(task_id, target_task_id, claim_sequence)`.
- Change `task_gate_release_members` identity and foreign key to use `claim_sequence`.
- Update claim-time gate release inserts to write the claimed Task's current `claim_sequence` and `attempts`.
- Update late-growth protection and marker storage to reference released gates by claim sequence rather than attempt.
- Update read-model, Engine types, render text, JSON shapes, event payloads, snapshots, and tests wherever gate-release identity is exposed so audit output does not imply attempt is still the unique identity.
- Keep `attempt` visible only as retry-cycle metadata where useful for readability.

## Done when

- A gated task can be claimed, cleaned up/reclaimed, and claimed again with distinct gate release rows keyed by increasing `claim_sequence`.
- Existing dynamic gate claimability and late-growth protection tests pass under the new gate-release identity.
- Tests prove two claims can both have retry-cycle attempt values that may later repeat after replay without colliding because release identity is `claim_sequence`.
- Render/JSON snapshots that mention released gates or late-growth markers use claim-sequence wording for identity.
- Pithos typecheck and relevant Pithos tests pass.

## Out of scope

- Do not implement `pithos task replay`.
- Do not reset attempts anywhere in this task.
- Do not update Pandora prompt guidance.
- Do not write legacy migrations for existing databases; this alpha change assumes DB recreation.

## References

- `specs/task-replay.md`
- `specs/task-graph.md`
- `packages/pithos/src/db.ts`
- `packages/pithos/src/engine/claim-loop.ts`
- `packages/pithos/src/engine/late-growth.ts`
- `packages/pithos/src/engine/task-read-model.ts`
- `packages/pithos/src/engine/render.ts`
- `packages/pithos/test/task-lifecycle.test.ts`
- `packages/pithos/test/render.test.ts`
