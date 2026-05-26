# Task 16: Add replay engine transition

## Scope

Type: AFK

Add the durable Pithos Engine transition that lets Pandora resolve a held Repair Alert by replaying its target Task. This task owns the transactional state mutation and Engine-level behavior, not the public CLI surface.

## Must implement exactly

- Add an Engine replay operation with typed input/output matching the planned contract: target task id, actor run id, Repair Alert fencing token, and non-empty reason.
- Validate fail-loud preconditions inside the transaction:
  - actor run is live and belongs to `pandora`
  - actor run holds exactly one Task
  - held Task fencing token matches the supplied token
  - held Task is an `escalate` Task with a `repair_alerts` row
  - held Task has a `repair` edge to the target Task
  - target Task exists
  - target Task is not superseded by another Task
  - target Task status is `failed`, `dead_letter`, or `cancelled`
  - target Task scope is active and passes the same scope-validity policy used by comparable Task repair mutations
  - reason is non-empty
- Reset the target Task to operational zero state: `queued`, `attempts = 0`, `result_json = '{}'`, `completed_at = NULL`, `fencing_token += 1`, preserving `max_attempts` and `claim_sequence`.
- Complete the held Repair Alert in the same transaction with result metadata indicating replay resolution, target task id, and reason.
- Clear the held Repair Alert from Pandora's run in the same way normal task completion clears held work.
- Emit `task.replayed` for the target and normal completion evidence for the Repair Alert.

## Done when

- Engine tests cover successful replay for `failed`, `dead_letter`, and `cancelled` target Tasks.
- Tests prove replay resets `attempts` but preserves `claim_sequence`, artifacts, edges, and historical events.
- Tests prove the Repair Alert is completed and the Pandora run no longer holds it after replay.
- Tests cover stale token, non-Pandora actor, missing/mismatched repair edge, nonexistent target, empty reason, invalid target status, archived/invalid target scope, and superseded target rejection.
- Relevant Pithos lifecycle tests pass.

## Out of scope

- Do not expose the CLI command yet.
- Do not change pdx supervision policy.
- Do not let War, Toil, Greed, Envy, or pdx replay tasks.
- Do not delete historical events, artifacts, runs, Repair Alerts, or gate-release rows.

## References

- `specs/task-replay.md`
- `packages/pithos/src/engine.ts`
- `packages/pithos/src/engine/types.ts`
- `packages/pithos/src/engine/repair-alerts.ts`
- `packages/pithos/src/engine/task-read-model.ts`
- `packages/pithos/test/task-lifecycle.test.ts`
