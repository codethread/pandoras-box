# Pithos Task Graph

**Status:** Implemented
**Last Updated:** 2026-06-15

## 1. Overview

### Purpose

Pithos owns the durable **Task graph** for Pandora's Box: Scopes, Tasks, typed Task edges, Supersessions, Task Replay, Claims, Runs, active/rejected Artifacts, Events, and inspection surfaces. The graph lets Agents and Pandora understand where work belongs, what is claimable, what is waiting on branch completion, what replaced what, and what context belongs to a Task chain without relying on prompt memory.

### Goals

- Make scope placement, claimability, coordination checkpoints, and attention routing durable graph facts, not prompt memory.
- Keep auditable history for Gate releases (snapshotted per Claim sequence), Supersession, Task Replay, and Artifacts.
- Fail loudly on mutations that would silently invalidate active downstream work.
- Give Agents focused inspection surfaces: scope inventory, single-Task dossiers, graph topology maps, and agenda briefings.

### Non-Goals

- No free-form Task relationships: the four typed edge kinds plus Supersession replacement history are the whole relationship vocabulary.
- No invariant storage in Events: event rows are prunable audit evidence, and graph correctness must not depend on retained history.
- No supervision policy: Run lifecycle (Kill, Cleanup, Interrupt), Repair Alert kinds, and routing of Broken chains are owned by the Control plane ([control-plane-supervision.md](./control-plane-supervision.md)).

## 2. Design Decisions

- **Decision:** `about` and `repair` edges are singular and mutually exclusive per Task.
  - **Rationale:** Continuation policy needs exactly one branch-attention anchor per Task.

- **Decision:** Branch closure and gate checks canonicalize Tasks through Supersession replacement chains.
  - **Rationale:** Superseded old Tasks remain inspectable history without their cancellation poisoning a gate when a replacement exists.

- **Decision:** Supersession is replacement history, not a generic edge kind.
  - **Rationale:** Replacement has different retargeting and provenance rules than coordination edges; conflating them would let started work be silently retargeted.

- **Decision:** `attempts` (resettable) and `claim_sequence` (monotonic) are separate counters.
  - **Rationale:** The retry budget and lifetime claim identity serve different needs — audit rows such as gate releases need a stable identity that survives Task Replay resets.

- **Decision:** Branch growth beneath a released gate fails loudly while downstream work is active.
  - **Rationale:** Late growth can invalidate work already unblocked by the release; the Agent/operator must interrupt, supersede, or replan deliberately rather than have the graph absorb it silently.

- **Decision:** Task Replay resets operational state but preserves Task identity and history.
  - **Rationale:** Task Replay targets execution-context failures where the work definition is still valid; changed definitions use Supersession instead.

- **Decision:** Repo/worktree Scope identity is derived from its normalized path, not from a mutable display name.
  - **Rationale:** Scope identity is a durable placement fact used by Tasks, Runs, launch preconditions, and inspection. A path-derived id prevents ambiguous aliases for the same runtime location.

- **Decision:** Scope archival preserves history only when history exists.
  - **Rationale:** A never-used Scope is configuration noise and can be deleted; a Scope with Tasks or Runs is graph history and must remain inspectable even when retired.

- **Decision:** Missing repo/worktree paths are observed, not silently repaired.
  - **Rationale:** Filesystem disappearance may invalidate queued work. Pithos should fail new scoped mutations loudly, while pdx routes unlaunchable queued work to Pandora through launch-precondition Repair Alerts.

- **Decision:** Payload-bearing CLI commands read exactly one explicit stdin document, only when `--stdin` is passed.
  - **Rationale:** Explicit payload intent keeps required-vs-optional body semantics per command unambiguous and makes missing or malformed payloads tagged, traceable errors.

## 3. Scopes

A Scope is the durable placement boundary for Tasks and Runs. Scopes answer where work belongs before Agents claim it; they are not Agent policy and they do not replace typed Task edges.

| Kind       | Identity and path contract                                                                     | Primary use                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `global`   | Built-in `global`; no filesystem path; cannot be archived.                                     | System/Pandora work such as `escalate` and `intake`.                        |
| `repo`     | `repo:<path>` using Pithos' normalized absolute path string, stored as `canonical_path`.       | Repository-scoped work, including `execute`.                                |
| `worktree` | `worktree:<path>` using the normalized worktree path plus a normalized parent repository path. | Worktree-scoped execution while preserving the parent repository reference. |

Capability placement is enforced when Tasks are admitted or claimed. `escalate` and `intake` require global Scope. `execute` requires an active repo or worktree Scope with a recorded path; worktree execution also requires a parent repository path. Other Capabilities may be placed in any active Scope unless a narrower workflow policy chooses otherwise.

### Scope creation and reactivation

`scope upsert` creates or updates the Scope identity for the requested kind/path. Repo and worktree paths must exist as directories when upserted; worktree Scopes also require an existing parent repository directory. Upserting an archived Scope with the same identity reactivates it by clearing archival state. Scope descriptions are operator context: they do not affect claimability, authorization, or graph invariants.

### Scope archive and deletion

Only inactive non-global Scopes can be archived. Archival fails while the Scope has live Runs or non-terminal Tasks. If the Scope has any historical Tasks or Runs, archive marks it retired and hides it from default Scope lists while keeping it available in `--all` views and historical graph context. If the Scope has never been referenced by a Task or Run, archive deletes it instead of creating permanent history for unused configuration.

Archived Scopes reject new admission: Runs cannot be upserted into them, Tasks cannot be enqueued into them, queued work cannot be superseded into them, and Task Replay cannot reopen work whose Scope is retired. Existing terminal history remains inspectable.

### Missing runtime paths

Repo/worktree Scope paths are durable recorded facts, but the filesystem can disappear after upsert. Scope listing surfaces this as `path_missing`; this is an observation, not a Scope state transition.

Pithos validates repo/worktree path existence when new work is admitted or replayed into the Scope. Launch-time handling for already-queued work with missing paths belongs to the Control plane's launch-precondition Repair Alert flow; see [control-plane-supervision.md](./control-plane-supervision.md).

## 4. Typed Task edges

Every durable relationship between Tasks uses `task_edges` with direction:

```text
new/follow-up task --edge-kind--> referenced target task
```

| Kind     | Blocks owner?                   | Adds owner to target branch? | Meaning                                          |
| -------- | ------------------------------- | ---------------------------- | ------------------------------------------------ |
| `after`  | Yes, until target is `done`     | Yes                          | Direct prerequisite.                             |
| `gate`   | Yes, until target branch drains | No                           | Coordination checkpoint over an evolving branch. |
| `about`  | No                              | Yes                          | Immediate attention/context about target work.   |
| `repair` | No                              | Yes                          | System-authored Repair Alert for broken work.    |

`after` and `gate` are repeatable. `about` and `repair` are singular and mutually exclusive for one Task so continuation policy has one branch-attention anchor.

### Branch closure

For an anchor Task `A`, branch closure starts at `canonical(A)` and traverses incoming `after`, `about`, and `repair` edges until no more canonical owners are found. `gate` edges are excluded from branch membership.

`canonical(task)` follows Supersession replacement chains to the latest replacement for closure and gate checks. Superseded old Tasks remain inspectable history; their cancellation does not poison a gate when a replacement exists.

### Gate claimability and release

A `gate` edge from owner `T` to anchor `A` is satisfied when every canonical member of `branchClosure(A)` is `done`.

Inspection states:

| State    | Closure contents                                                              | Effect                                                           |
| -------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `clear`  | all canonical members are `done`                                              | gate no longer blocks                                            |
| `open`   | any member is queued/claimed/running                                          | owner is not claimable                                           |
| `broken` | any member is failed/cancelled/dead-lettered without transparent Supersession | owner is not claimable and inspection surfaces the broken branch |

Gate checks are dynamic while the owner is queued. New `after`/`about`/`repair` work under the anchor before Claim can move a gate from clear back to open.

When a gated Task is claimed, Pithos evaluates gates inside the Claim transaction and records `task_gate_releases` plus `task_gate_release_members` for that claim sequence. Historical release rows are audit snapshots; a later requeue requires a fresh release for the next claim sequence. Pithos emits `task.gate_released` with task id, target anchor, claim sequence, descriptive attempt, fencing token, releasing run, and snapshot members.

### Late branch-growth protection

After a gate release, adding branch-member growth (`after`, `about`, `repair`) beneath the released anchor or superseding a released/current branch member can invalidate downstream work. Pithos checks affected released gates inside the mutation transaction.

If any task in the downstream impact closure from the gate owner is non-terminal, the mutation fails loudly. The Agent/operator must interrupt, supersede, or explicitly replan active downstream work first. If all impacted downstream work is terminal, the mutation is allowed and Pithos records a `task_gate_late_growth_markers` row so inspection can show late branch growth after a prior release.

### Graph integrity

Pithos validates edges at insertion time using canonical Task ids:

- `after`/`about`/`repair` branch-membership edges are acyclic.
- A `gate` owner cannot already be in `branchClosure(target)`.
- The blocking graph formed by direct `after` edges and direct `gate` targets is acyclic.
- `about` and `repair` are singular and mutually exclusive per Task.

## 5. Claimability

A Task is claimable when:

- `tasks.status = 'queued'`
- all outgoing `after` targets canonicalize to `done`
- all outgoing `gate` target branch closures are clear
- the requested Run is authorized for the Capability
- the requested Scope exactly matches the Run Scope
- the Run has no current Held task

Claim increments `attempts`, `claim_sequence`, and the Fencing token together, stores the Held task on the Run, and records gate release snapshots when gates release. `attempts` is the resettable retry-budget counter used with `max_attempts`; `claim_sequence` is the monotonic lifetime claim identity used for audit rows such as gate releases and late-growth markers. A Run may hold at most one Task at a time.

## 6. Chain policy and CLI shape

`pithos task enqueue` exposes edge-oriented flags:

| Flag                  | Edge kind | Description                                               |
| --------------------- | --------- | --------------------------------------------------------- |
| `--after <task-id>`   | `after`   | This Task waits for the target Task directly.             |
| `--gate-on <task-id>` | `gate`    | This Task waits for the target branch to drain.           |
| `--about <task-id>`   | `about`   | This Task is immediate attention/context for target work. |
| `--repair <task-id>`  | `repair`  | System-authored Repair Alert edge for target work.        |

`--repair` is restricted to the `pdx` system actor. Ordinary Agents must route broken work through the implemented Repair Alert flows.

`--chain auto|none|held` is enqueue policy sugar:

- ordinary held-task continuation creates `after`
- held ordinary work to escalation creates `about`
- held `about` or `gate` escalation to ordinary continuation creates `after` to the held escalation; the escalation edge keeps branch/checkpoint context attached
- held `repair` escalation cannot ordinary-auto-continue; `--chain auto` fails loudly and Pandora must repair with Task Replay, Supersession, explicit replanning, or intentional cancellation
- `--chain none` creates no implicit edges, though manual edge flags still apply

Requested `review` Tasks are ordinary non-escalation work claimed by Greed. Reviews are usually created with `after` edges to the work they assess; fan-in reviews use repeatable `--after`.

## 7. Supersession

`pithos task supersede <task-id>` creates a fresh replacement Task, records replacement history in `task_supersessions`, and may cancel the old queued Task in the same transaction.

Rules:

- queued direct `after` and `gate` owners are retargeted from old target to replacement, preserving edge kind
- `about` and `repair` edges stay attached to the original Task for provenance
- branch closure and gate satisfaction canonicalize superseded Tasks to latest replacements
- direct edge owners in non-queued/non-cancelled states fail loudly so started work is not silently retargeted
- superseding a member beneath a released gate must pass the late-growth check

Supersession is replacement history, not a generic edge kind.

## 8. Task Replay

`pithos task replay <target-task-id> --token <repair-alert-token> --reason <text> [--run <pandora-run-id>]` is Pandora's lightweight Repair Alert resolution for retrying the same Task after an execution-context or external-precondition failure. Task Replay is used when the Task id, body, assumptions, Capability, and Scope remain correct; use Supersession when the work definition must change.

Task Replay is authorized only while Pandora holds the matching system-authored Repair Alert. Pithos validates in one transaction that the actor Run is live Pandora, the held Repair Alert fencing token matches `--token`, the alert has a `repair` edge to the target, the target exists in an active valid Scope, the target status is `failed`, `dead_letter`, or `cancelled`, the target is not superseded, and `--reason` is non-empty. Invalid replay preconditions fail loudly; workers cannot replay their own Tasks and completed/queued/claimed Tasks are not replay targets.

Successful replay resets the target Task to queued operational state while preserving history:

- sets status to `queued`
- resets `attempts` to `0` for a fresh retry budget
- increments the target Fencing token
- clears completion/result state
- preserves `id`, Scope, Capability, title/body, `max_attempts`, `claim_sequence`, edges, Supersession history, Artifacts, Events, Runs, and gate-release snapshots
- completes the held Repair Alert with `{ "resolution": "replayed", "target_task_id": ..., "reason": ... }` and clears it from Pandora's Run

Task Replay emits `task.replayed` for the target with the reason, Repair Alert id, previous status/attempts/fencing token, and new fencing token. It also emits the ordinary `task.completed` event for the Repair Alert with replay resolution metadata. Event rows are audit evidence, not the invariant store.

## 9. Payload CLI contract

Payload-bearing public CLI commands use one explicit stdin document:

| Command                                                      | Payload rule                                                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `pithos task enqueue ... --stdin`                            | required non-empty Task body                                                                                                 |
| `pithos task supersede ... --stdin`                          | required non-empty replacement Task body                                                                                     |
| `pithos task artifact add ... --token <token> ... [--stdin]` | optional Artifact body; omitted means empty body; held-task ownership, fencing token, and lower-snake-case kind are required |
| `pithos task complete ... [--stdin]`                         | optional JSON object completion metadata; omitted means `{}`                                                                 |

The CLI reads stdin only when `--stdin` is present. Missing redirected stdin, empty required payloads, invalid completion JSON, and conflicting `--run`/`PITHOS_RUN_ID` fail with tagged Pithos errors.

## 10. Artifacts and completion contracts

Artifacts are append-only evidence rows with current status `active` or `rejected`. New artifacts start active. Rejection is one-way, preserves body/authorship history, emits `task.artifact_rejected`, and removes the artifact from primary task/graph views and required-artifact satisfaction. `task artifact list` and exact-id `task artifact show` expose active and rejected history.

Artifact mutation commands are fenced held-task writes:

```text
pithos task artifact add <task-id> [--run <run-id>] --token <token> --kind <kind> --title <title> [--stdin]
pithos task artifact reject <artifact-id> [--run <run-id>] --token <token> --reason <reason>
pithos task artifact list <task-id> [--json]
pithos task artifact show <artifact-id> [--json]
```

`add` and `reject` require active held-task ownership and a matching Fencing token. Artifact `kind` values are lower snake case.

When `$PDX_USER_DATA_DIR/artifacts.toml` exists and contains required rules for a Task Capability, `task complete` requires at least one active artifact with each required `kind`. Rejected artifacts do not satisfy requirements. Completion enforcement checks presence only, not artifact title, body, content, or count. Completed Tasks are not retroactively revalidated after config changes. [artifact-contracts.md](./artifact-contracts.md) owns the detailed user config, CLI, lifecycle, and enforcement contract.

## 11. Inspection surfaces

### `pithos task inspect <task-id> [--json] [--full]`

Readable output is the normal Agent handoff for a single Task dossier: full task body, an associated `run:` line when known from active ownership or task lifecycle evidence, compact active Artifact refs, direct `after` blockers/dependents, direct `gate` coordination state and branch members, directly attached `about`/`repair` context, Supersession context, and late-growth markers. It does not recursively expand upstream lineage in readable mode. `--full` renders active Artifact bodies inline. `--json` returns the structured inspect object with active Artifacts only; `--full --json` is invalid because `--full` affects Markdown rendering only.

### `pithos graph inspect (--task <id>|--scope <id>|--all) [filters] [--json]`

Graph inspect is the relationship-map surface for Task graph topology, provenance, gates, and Supersession history. It selects seed Tasks, then returns a closed graph over typed edges and Supersessions. Filters narrow seed selection before closure:

- repeatable `--status`: OR over Task statuses
- repeatable `--search`: AND over case-insensitive Task title/body substrings
- `--since`: `today`, `<n>h`, `<n>d`, `YYYY-MM-DD`, or ISO timestamp with timezone

Closure may include related Tasks that do not match filters so blockers, attached context, gates, and replacement history remain understandable. Scope graph inspection may include global `about`/`repair` escalation Tasks attached to selected scoped work, and global checkpoint escalations whose `gate` target is in selected scoped closure.

Readable graph output is map-oriented. It labels typed Task edges (`after`, `about`, `repair`, and `gate [state]`), shows referenced Tasks before incoming owners/follow-ups, and renders each Task as a compact card with id/capability/status/title, scope, an associated `run:` line when known from active ownership or task lifecycle evidence, `preview:` from the Task title, and active `artifacts:` refs (`artifact_id [kind] title`) only when active artifacts exist. Gate members render as computed branch-closure blocks and Supersession renders as replacement history. It does not own full task bodies, full Artifact bodies, next-action hints, or agenda/sitrep summaries; use `task inspect` for single-Task drill-down and `briefing` for agenda/attention summaries.

`graph inspect --json` preserves the structured graph output contract for the same selection and closure, including edge kind, gate state, per-node preview, and active artifact refs. For claimed/running Tasks with required Artifact Contract rules, graph JSON includes compact `requirement_status.missing_required`; readable graph output surfaces only missing required artifacts.

### `pithos briefing [--agent pandora] [--json]`

Briefing owns agenda questions: ready work, blocked/gated work, broken branches, recent completions, and Pandora-oriented summaries. Use graph inspect for graph inventory, provenance, and audit; use briefing for what needs attention next.

## 12. Data model

Key tables include `scopes`, `tasks` (with resettable `attempts` and monotonic `claim_sequence`), `runs`, `task_edges`, `task_gate_releases`, `task_gate_release_members`, `task_gate_late_growth_markers`, `task_supersessions`, `artifacts`, and `events`. `runs.has_claimed_task` is the durable record that a Run has claimed work, so timeout/launch-abort semantics do not depend on retained event history. Event rows are retention-managed operational history and may be pruned by age through the Engine library boundary.

The system lives in `packages/pithos`; its README documents module boundaries, its test suite covers behavior, and generated CLI help is the command syntax source.
