# Task Replay

**Status:** Planned
**Last Updated:** 2026-05-26

## 1. Overview

### Purpose

Task Replay lets Pandora repair execution-context failures by resetting the same broken Task back to claimable work without replacing it through Supersession. It is for cases where the Task definition remains correct but the prior attempt should not count: VPN was off, a worktree was prepared from the wrong branch, credentials were missing, or another external precondition prevented useful work.

Replay is an explicit Repair Alert resolution. Pandora must claim the system-authored Repair Alert, inspect the broken work, decide replay is valid, then run a fenced replay transition that resets the target Task and completes the Repair Alert in one transaction.

### Goals

- Preserve the original Task id when the work definition is still valid.
- Reset operational state so the Task can be claimed again with a fresh retry budget.
- Preserve audit history: prior runs, events, artifacts, Repair Alerts, and gate-release snapshots remain durable evidence.
- Keep replay behind Pandora's Repair Alert workflow; no hidden worker self-retry.
- Split retry budget from claim audit identity with a monotonic `claim_sequence`.
- Keep database integrity fail-loud and transactional.

### Non-Goals

- No Same-run resurrection. Replay creates claimable work for a future fresh Run.
- No history deletion. Replay does not erase failure/cancel/dead-letter events, artifacts, runs, or gate-release history.
- No automatic retry loop. Agents such as War cannot replay their own failed work.
- No replacement of incorrect work definitions. Use Supersession when the Task body, assumptions, scope, or plan need to change.
- No replay for completed work. Repeating successful work is a new Task or explicit replan.
- No schema migration compatibility. Pandora's Box is alpha software; operators will drop/recreate the DB for this change.

## 2. Design Decisions

- **Decision:** Replay preserves the same Task id.
  - **Rationale:** The user-facing need is “try this exact work again now that the environment is fixed.” Supersession already covers replacing incorrect work while preserving history.

- **Decision:** Replay is an operational reset, not historical erasure.
  - **Rationale:** Pithos is the durable source of truth. Deleting events, artifacts, runs, or gate releases would make later investigation less trustworthy and would spread fragile cleanup logic through the graph.

- **Decision:** Replay is only authorized through a held matching Repair Alert claimed by Pandora.
  - **Rationale:** Broken work should reach the human/Pandora repair lane before being retried. This prevents hidden retries by execution agents and gives Pithos a precise transactional precondition.

- **Decision:** Replay completes the held Repair Alert in the same transaction that resets the target Task.
  - **Rationale:** Leaving the Repair Alert open after successful replay would create stale attention and duplicate work. Atomic resolution keeps the graph coherent.

- **Decision:** Eligible target statuses are `failed`, `dead_letter`, and `cancelled`.
  - **Rationale:** These are the broken/terminal states that can represent an invalid attempt or launch context. Active, queued, and done work are not replay targets.

- **Decision:** Superseded old Tasks cannot be replayed.
  - **Rationale:** Supersession defines canonical replacement. Replaying an old superseded Task would fork the repair model and make branch closure ambiguous. The current canonical replacement may itself be replayed if it later breaks.

- **Decision:** Add `tasks.claim_sequence` as monotonic lifetime claim identity.
  - **Rationale:** `attempts` currently carries two meanings: retry budget and gate-release audit identity. Replay needs to reset retry budget while preserving unique historical claim identity. Splitting the fields captures intent and avoids deleting gate-release rows.

- **Decision:** `attempts` remains resettable retry budget; `claim_sequence` never resets.
  - **Rationale:** A replayed dead-letter Task must receive a fresh retry budget. Gate releases, late-growth markers, and audit trails still need stable unique identity across all claims in the Task lifetime.

- **Decision:** Gate-release primary identity moves from `attempt` to `claim_sequence`.
  - **Rationale:** After replay, attempt numbers can repeat within a new retry cycle. `claim_sequence` is the unique per-Task claim number and therefore the correct key for gate-release snapshots and late-growth markers.

- **Decision:** Do not implement legacy migrations for existing DBs.
  - **Rationale:** This is alpha software and the operator accepts dropping/recreating the DB. Code should be written as if the new schema always existed, avoiding compatibility branches and noisy migration logic.

## 3. Architecture

### Component structure

Replay belongs to Pithos because it mutates durable Task graph state and enforces graph invariants. pdx may later expose an ergonomic wrapper, but the core transition is a Pithos Engine and CLI operation.

Primary code areas to change:

| Area                             | Files                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Schema and built-in DB contract  | `packages/pithos/src/db.ts`                                                                                              |
| Row schemas                      | `packages/pithos/src/rows.ts`                                                                                            |
| Engine API contracts             | `packages/pithos/src/engine/types.ts`                                                                                    |
| Claim/gate-release writes        | `packages/pithos/src/engine/claim-loop.ts`                                                                               |
| Replay transition                | `packages/pithos/src/engine.ts` or a focused `packages/pithos/src/engine/replay.ts` helper wired through `engine.ts`     |
| Late-growth gate-release linkage | `packages/pithos/src/engine/late-growth.ts`                                                                              |
| Task read model and renderers    | `packages/pithos/src/engine/task-read-model.ts`, `packages/pithos/src/engine/render.ts`                                  |
| CLI command                      | `packages/pithos/src/cli.ts`                                                                                             |
| Agent prompt guidance            | `resources/data-dir/templates/agents/pandora.md`                                                                         |
| Tests                            | `packages/pithos/test/task-lifecycle.test.ts`, `packages/pithos/test/cli.test.ts`, `packages/pithos/test/render.test.ts` |

### Replay flow

```text
Pandora run holds Repair Alert R
  -> pithos task replay T --run pandora-run --token R-token --reason ...
  -> Pithos validates R is a live held matching Repair Alert for T
  -> Pithos validates T is replayable and canonical
  -> transaction:
       reset T to queued zero state
       increment T fencing token
       reset T attempts to 0
       complete R with replay resolution metadata
       clear R from Pandora run
       emit task.replayed for T
       emit task.completed for R
  -> next reconcile may spawn the relevant Agent for T
```

## 4. Data Model

### Tasks

Add `claim_sequence` to `tasks`:

```sql
claim_sequence INTEGER NOT NULL DEFAULT 0
```

Field meanings after this change:

| Field            | Meaning                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `attempts`       | Resettable retry count since the last replay/reset. Used for `max_attempts` dead-letter budget.         |
| `max_attempts`   | Retry policy for the current replay cycle. Preserved by replay.                                         |
| `claim_sequence` | Monotonic lifetime claim number for this Task. Never reset. Used for audit identity.                    |
| `fencing_token`  | Stale-write guard. Incremented on claim, cleanup/reclaim, interrupt/failure paths as today, and replay. |

### Claim mutation

On successful claim, update all three counters:

```sql
UPDATE tasks
SET status = 'claimed',
    attempts = attempts + 1,
    claim_sequence = claim_sequence + 1,
    fencing_token = fencing_token + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?
  AND status = 'queued'
RETURNING id, fencing_token, attempts, claim_sequence, capability;
```

### Gate release identity

Gate release rows store both `claim_sequence` and `attempt`, but key and foreign-key relationships use `claim_sequence`.

Conceptual schema shape:

```sql
CREATE TABLE task_gate_releases (
    task_id TEXT NOT NULL REFERENCES tasks(id),
    target_task_id TEXT NOT NULL REFERENCES tasks(id),
    claim_sequence INTEGER NOT NULL,
    attempt INTEGER NOT NULL,
    fencing_token INTEGER NOT NULL,
    released_by_run_id TEXT NOT NULL REFERENCES runs(id),
    released_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (task_id, target_task_id, claim_sequence)
);

CREATE TABLE task_gate_release_members (
    task_id TEXT NOT NULL,
    target_task_id TEXT NOT NULL,
    claim_sequence INTEGER NOT NULL,
    member_task_id TEXT NOT NULL REFERENCES tasks(id),
    canonical_task_id TEXT NOT NULL REFERENCES tasks(id),
    status_at_release TEXT NOT NULL,
    PRIMARY KEY (task_id, target_task_id, claim_sequence, member_task_id),
    FOREIGN KEY (task_id, target_task_id, claim_sequence)
        REFERENCES task_gate_releases(task_id, target_task_id, claim_sequence)
);
```

Late-growth markers should likewise point at gate claim sequence. The marker may keep an `gate_attempt` descriptive field only if useful for rendering, but identity must be `gate_claim_sequence`.

### Replay target mutation

Replay resets the target Task to operational zero state:

```sql
UPDATE tasks
SET status = 'queued',
    attempts = 0,
    fencing_token = fencing_token + 1,
    result_json = '{}',
    completed_at = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?
  AND status IN ('failed', 'dead_letter', 'cancelled');
```

Replay preserves:

- `id`
- `scope_id`
- `capability`
- `title`
- `body`
- `created_by_run_id`
- `created_at`
- `max_attempts`
- `claim_sequence`
- artifacts
- events
- runs
- edges
- supersession history
- gate-release history

## 5. Interfaces

### CLI

Add:

```sh
pithos task replay <target-task-id> --run <pandora-run-id> --token <repair-alert-token> --reason <text>
```

`PITHOS_RUN_ID` may supply the actor run when `--run` is omitted, following existing mutating Task command behavior. A conflicting `--run` and `PITHOS_RUN_ID` fails through the existing run-id resolution path.

Successful output should be JSON by default, consistent with mutating Task commands:

```json
{
	"ok": true,
	"task": {
		"id": "task_...",
		"status": "queued"
	},
	"repair_alert": {
		"id": "task_...",
		"status": "done"
	}
}
```

### Validation contract

Replay fails loudly when:

- actor run is not live
- actor run is not Pandora
- actor run does not hold a Task
- held Task fencing token does not match `--token`
- held Task is not an `escalate` Task
- held Task has no `repair_alerts` row
- held Task has no `repair` edge to the target Task
- target Task does not exist
- target Task status is not `failed`, `dead_letter`, or `cancelled`
- target Task has been superseded by another Task
- target Scope is archived or otherwise invalid under existing Task mutation rules, if such checks are already applied consistently to repair mutations
- reason is empty

### Events

Replay emits `task.replayed` for the target Task. Payload should include enough context for audit without requiring event history to be an invariant store:

```json
{
	"reason": "VPN restored",
	"repair_alert_task_id": "task_...",
	"previous_status": "failed",
	"previous_attempts": 2,
	"previous_fencing_token": 7,
	"new_fencing_token": 8
}
```

Replay also emits the normal `task.completed` event for the Repair Alert with completion metadata equivalent to:

```json
{
	"resolution": "replayed",
	"target_task_id": "task_...",
	"reason": "VPN restored"
}
```

The Repair Alert Task's `result_json` should store the same resolution metadata.

## 6. Implementation Phases

### Phase 1: Claim identity split

- [ ] Add `claim_sequence` to the `tasks` schema with no legacy migration path.
- [ ] Update Task row decoding and Task detail output as needed.
- [ ] Update claim transition to increment and return `claim_sequence` internally.
- [ ] Move gate-release PK/FK identity from `attempt` to `claim_sequence`.
- [ ] Update late-growth enforcement and marker writes to use gate claim sequence.
- [ ] Update render text, JSON shapes, snapshots, and tests for gate release identity wording.

### Phase 2: Replay Engine transition

- [ ] Add Engine replay input/output contract.
- [ ] Implement fenced Pandora-held Repair Alert validation.
- [ ] Implement target replay reset and Repair Alert completion in one transaction.
- [ ] Emit `task.replayed` and Repair Alert `task.completed` events.
- [ ] Reject superseded old target Tasks.
- [ ] Cover failed, dead-letter, cancelled, stale token, mismatched repair edge, non-Pandora actor, and superseded target behavior.

### Phase 3: CLI and prompt contract

- [ ] Add `pithos task replay` CLI command.
- [ ] Add CLI tests for success, stdin/env run resolution, validation failures, and JSON output.
- [ ] Update generated help snapshots/expectations.
- [ ] Update Pandora Repair Alert guidance to prefer replay for valid execution-context failures and Supersession for changed work definitions.

### Phase 4: Living spec upsert

- [ ] After implementation passes verification, fold this change spec into `specs/task-graph.md`.
- [ ] Remove or mark this change spec as superseded once the living spec contains the implemented contract.

## 7. Code Locations

| File                                             | Planned change                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `packages/pithos/src/db.ts`                      | Add `claim_sequence`; change gate release and late-growth marker schema to key by claim sequence. |
| `packages/pithos/src/rows.ts`                    | Decode new Task and marker fields.                                                                |
| `packages/pithos/src/engine/types.ts`            | Add replay contract and claim-sequence output fields where needed.                                |
| `packages/pithos/src/engine/claim-loop.ts`       | Increment claim sequence on claim; write gate releases with claim sequence.                       |
| `packages/pithos/src/engine/late-growth.ts`      | Read/write gate-release identity by claim sequence.                                               |
| `packages/pithos/src/engine/task-read-model.ts`  | Surface claim sequence and late-growth marker identity as needed.                                 |
| `packages/pithos/src/engine/render.ts`           | Render replay/gate identity changes without overexposing internal counters in normal task cards.  |
| `packages/pithos/src/engine.ts`                  | Wire replay operation or delegate to focused helper.                                              |
| `packages/pithos/src/cli.ts`                     | Add `task replay` command and help metadata.                                                      |
| `packages/pithos/test/task-lifecycle.test.ts`    | Add core replay and claim-sequence behavior tests.                                                |
| `packages/pithos/test/cli.test.ts`               | Add replay CLI tests and help expectations.                                                       |
| `packages/pithos/test/render.test.ts`            | Update late-growth marker snapshots if text changes.                                              |
| `packages/pithos/README.md`                      | Update Pithos module/invariant notes after implementation.                                        |
| `resources/data-dir/templates/agents/pandora.md` | Teach Pandora when to replay vs supersede.                                                        |
| `specs/task-graph.md`                            | Upsert final implemented contract after code lands.                                               |

## 8. Open Questions

None currently. If implementation exposes unexpected coupling, prefer the repository heuristics: preserve durable audit, fail loudly, keep repair explicit through Pandora, and avoid legacy compatibility branches for the alpha DB reset.
