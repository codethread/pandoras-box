# @pdx/pithos

Developer documentation for the Pithos package: the durable state system for Pandora's Box.

## Package role

`@pdx/pithos` exposes the `pithos` binary and the typed library boundary used by `pdx`.

For the generated CLI surface, use help instead of copying command lists here:

```sh
pithos --help
pithos --help-json
pithos scope --help
pithos run --help
pithos task --help
pithos graph --help
pithos events --help
pithos briefing --help
```

`pithos --help-json` is consumed by Spawner when rendering role-filtered command cards for Agent run prompts.

## What Pithos is

Pithos is the durable source of truth for:

- Scopes
- Agent kinds and Capabilities
- Tasks and Claims
- Runs and Held tasks
- Fencing tokens, Attempts, and monotonic Claim sequences
- typed Task edges (`after`, `about`, `repair`, `gate`) and Supersessions
- Artifacts (including active/rejected audit metadata) and Events
- Task graph invariants and text/JSON inspection views

## What Pithos is not

- Not the local supervisor. `pdx` owns Registry state, live process/tmux resources, Kill policy, Cleanup, Interrupt orchestration, and Nudges.
- Not a Harness launcher. Spawner renders prompts, builds Harness argv/env, launches Harness sessions, and parses Harness session logs.
- Not a Control-plane backend. tmux is the current backend for HITL mode; Pithos only stores durable Run metadata.
- Not a prompt/template system. Pithos exposes state transitions and inspection surfaces; Agent instructions live in Spawner templates.

## Relation to other packages

| Package                       | Pithos integration                                                                           | Boundary                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `@pdx/pdx`                    | imports `makeEngine` and `liveServices` through the package root                             | typed in-process durable state transitions; no subprocess parsing                                      |
| `@pdx/spawner`                | imports `@pdx/pithos/builtins` and Artifact Contract helpers, and calls `pithos --help-json` | validates render config against built-ins, shares artifact-contract parsing, and renders command cards |
| `@pdx/cli-help`               | renders human `pithos --help` from the Effect command descriptor                             | custom terminal layout without duplicating command definitions                                         |
| Harness CLIs (`claude`, `pi`) | no direct integration                                                                        | Harness sessions are represented only by Run transcript metadata                                       |

The composed behavior is specified in [`../../specs/control-plane-supervision.md`](../../specs/control-plane-supervision.md) and Task graph semantics in [`../../specs/task-graph.md`](../../specs/task-graph.md). Use [`../../UBIQUITOUS_LANGUAGE.md`](../../UBIQUITOUS_LANGUAGE.md) for terms.

## Public package surface

Exported from `@pdx/pithos`:

- CLI helpers: `makePithosCommand`, `runPithosCli`, `renderPithosHelpJson`.
- Engine boundary: `makeEngine`, `Engine`, graph `--since` cutoff parsing, render helpers for briefing/graph/task inspect/artifact text, and library-only event pruning used by `pdx` maintenance.
- Schema/DB helpers: `migrate`, `openDb`, row schemas, decoded row helpers.
- Chain helpers: chain-policy resolution and typed-edge graph utilities.
- Config/services/errors: `loadConfig`, `liveServices`, `PithosError`.
- Artifact Contracts: `loadArtifactContract`, `loadConfiguredArtifactContractSync`, `parseArtifactContractToml`, `selectArtifactContractRules`, and normalized contract/rule types.

Exported from `@pdx/pithos/builtins`:

- built-in Agent kinds
- system actors
- spawnable Agent kinds
- Capabilities
- claim/enqueue authorization contract

Consumers should import from package roots, not sibling `src/*` internals.

## Artifact Contract and artifact APIs

Pithos parses and enforces user-owned Artifact Contracts from `$PDX_USER_DATA_DIR/artifacts.toml`; rules do not live in `agents.toml`. The package root exports the parser/loader, normalized types, and Capability selector for Spawner reuse.

Implemented artifact commands:

```sh
pithos task artifact add <task-id> [--run <run-id>] --token <token> --kind <kind> --title <title> [--stdin]
pithos task artifact reject <artifact-id> [--run <run-id>] --token <token> --reason <reason>
pithos task artifact list <task-id> [--json]
pithos task artifact show <artifact-id> [--json]
```

Add/reject require the resolved Run (`--run` or `PITHOS_RUN_ID`) to hold the parent Task with the current Fencing token. Rejected artifacts stay inspectable through list/show, but primary task/graph views and required-artifact checks use active artifacts only. `task inspect` shows compact active refs by default; `--full` adds active bodies for Markdown output. Required rules check active artifact `kind` presence only; titles and bodies are guidance.

## Implemented module design

### `src/main.ts` — process boundary

Loads runtime config from environment, wires live services, and runs the CLI. Unexpected top-level failures are printed as tagged JSON errors.

### `src/config.ts` — runtime config parsing

Parses process environment into typed config:

- `PITHOS_DB` — required database path
- `PITHOS_RUN_ID` — optional default actor Run id for mutating Agent commands
- `PDX_USER_DATA_DIR` — optional user config directory used to load `artifacts.toml` for Artifact Contract completion gates and graph requirement status

If both `PITHOS_RUN_ID` and `--run` are present for a command, Engine code fails loudly when they conflict.

### `src/artifact-contracts.ts` — user Artifact Contract parsing

Owns the optional parser for `$PDX_USER_DATA_DIR/artifacts.toml`. It returns an empty normalized contract when `PDX_USER_DATA_DIR` is unset or the file is absent, fails loudly for unreadable configured directories/files and invalid TOML/schema, defaults `required` to `false`, and exports capability-filtering helpers for Spawner reuse.

### `src/cli.ts` — CLI and output contract

Defines the command tree with `@effect/cli`, dispatches command handlers, and exposes both human and machine-readable help from that same descriptor structure.

Important details:

- Human `--help` / `help <command>` output is rendered by `@pdx/cli-help` from the Effect command descriptor; command/flag text is authored on `Command.withDescription`, `Args.withDescription`, and `Options.withDescription`.
- `--help-json` prints the command tree used by Spawner.
- Protocol/state-transition commands return JSON by default for Agent consumption.
- `pithos task replay <target-task-id> --token <repair-alert-token> --reason <text> [--run <pandora-run-id>]` is the Pandora-held Repair Alert resolution for resetting the same broken Task to queued work with a fresh retry budget.
- Context commands (`task inspect`, `graph inspect`, `briefing`) render readable text by default and expose `--json` for structured output. `task inspect` readable output is a single-task dossier: full task body, compact active artifact refs, and direct local context only; pass `--full` to render active artifact bodies inline. `graph inspect` readable output is a threaded map of compact task cards for the same unpruned graph selection returned by `--json`: topology, typed edges, title-based preview lines, non-empty active artifact refs, gate branch members, provenance, and Supersession history. Agenda/sitrep summaries stay with `briefing`.
- Payload-bearing task mutations read redirected stdin only when `--stdin` is present. Required payloads fail on empty/missing stdin; artifact bodies are optional when `--stdin` is omitted.

### `src/engine.ts` and `src/engine/*` — durable state transitions

`src/engine.ts` is the Pithos Engine composition root used by both the CLI and `pdx`: it preserves the public exports, initializes the DB, and assembles cohesive operation modules. Focused engine submodules own the durable behavior:

- `src/engine/types.ts` — public Engine input/output contracts.
- `src/engine/guards.ts` — shared IO-boundary validation, Run/Scope row guards, authorization, and capability/scope admission checks.
- `src/engine/render.ts` — pure task/graph/briefing text rendering.
- `src/engine/db-helpers.ts` — shared Engine DB open/migrate/close and ID-collision handling.
- `src/engine/event-log.ts` — durable event insert, tail, and retention pruning logic.
- `src/engine/scope-ops.ts` — scope upsert/list/archive, including repo/worktree directory admission checks.
- `src/engine/run-lifecycle.ts` — Run upsert/inspect, active-run lookup, Cleanup, Interrupt, timeout, and launch-abort transitions.
- `src/engine/task-mutations.ts` — task enqueue/replay/supersede, including chain policy, admission checks, late-growth enforcement, and event writes.
- `src/engine/claim-loop.ts` — Claim-loop transitions for claim, heartbeat, completion, failure, cancellation, and artifact attachment.
- `src/engine/inspection.ts` — artifact list/show, task inspect, graph inspect delegation, and briefing read surfaces.
- `src/engine/task-read-model.ts` — DB row parsing and reusable Task/Scope/typed-edge read-model queries used by transitions and inspections.
- `src/engine/graph-integrity.ts` — typed-edge graph invariant checks for branch-membership, gate-owner, and blocking cycles.
- `src/engine/graph-inspect.ts` — graph selector filtering, `--since` cutoff parsing, and typed-edge/Supersession closure assembly.
- `src/engine/repair-alerts.ts` — Repair Alert task creation, `repair` edge provenance, launch-precondition repair, and claimable Repair Alert kind queries.

Engine operations open the SQLite DB, check/update schema, execute transition logic, and close the DB per operation. Race-sensitive updates run inside SQLite transactions and use fenced preconditions so stale writes fail rather than drifting state. Artifact add/reject mutations require active held-task ownership and a matching fencing token. Rejection is one-way: rejected Artifacts remain exact-id inspectable but are excluded from primary active-artifact views. Scope/task admission validates external filesystem state at the Pithos boundary: repo/worktree paths must exist as directories when scopes are upserted and when tasks are enqueued or superseded into those scopes.

Artifact status/rejection is an alpha schema break rather than a data migration: an incompatible existing `artifacts` table fails loudly. Reset standalone Pithos databases with `pithos init --fresh`; for pdx-managed data dirs use `pdx init --clean` or `pdx open --clean`.

### `src/db.ts` — schema and seed data

Defines the SQLite schema and migration entrypoint.

Key tables:

- `scopes`
- `agent_kinds`, `capabilities`, `agent_claims`, `agent_enqueues`
- `runs` (includes durable `has_claimed_task` so Run timeout/launch-abort invariants do not depend on retained event history)
- `tasks`
- `task_edges` for `after`, `gate`, `about`, and `repair` relationships
- `task_gate_releases` and `task_gate_release_members` for per-Claim gate release audit snapshots
- `task_gate_late_growth_markers` for allowed late branch growth after released gates
- `task_supersessions`
- `artifacts`
- `events` (indexed for age-based pruning by `created_at` and `(type, created_at)`)

`migrate` enables foreign keys, creates/checks schema, and seeds the built-in global scope, Agent kinds, Capabilities, claim rules, and enqueue rules. Alpha schema breaks may require a fresh DB instead of in-place migration.

### `src/builtins.ts` — durable built-in contract

Defines the pre-v1 built-in contract for Agent kinds and Capabilities. Spawner validates its manifest against this file, and Pithos seeds/enforces the same contract in SQLite.

### `src/chain-policy.ts` — Task chain rules

Pure helpers for typed-edge chain and Supersession behavior:

- `--chain auto|none|held` resolution
- implicit `after` edge selection
- `about`/`repair` continuation policy for Escalation task handoff
- `after` edge dedupe
- branch-membership acyclicity checks
- graph closure and unresolved `after`/`gate` blocker helpers

Use this file for chain semantics before editing Engine enqueue/supersede logic.

### `src/rows.ts` — DB row parsing

Schemas for rows crossing the SQLite boundary. Malformed rows fail with `INTERNAL_ERROR`; missing rows fail with `NOT_FOUND`.

### `src/services.ts` — IO boundary

Defines the service interface used by CLI/Engine code:

- filesystem reads/removes and directory status checks
- stdin reading
- stdout/stderr writing
- ID generation — `task`, `run`, and `artifact` IDs use three random English words (`task_pear-orange-tree`); `event` IDs keep hex (`event_8f64959bbf004fda`)
- clock

`liveServices` is the Node implementation. Tests use deterministic service objects with real isolated SQLite DB files.

### `src/errors.ts` — error contract

Defines `PithosError` and exit-code mapping. Keep new runtime failures tagged with existing machine-readable codes unless a new code is intentionally added.

## DB and invariant notes

Pithos owns durable invariants, not live resource observation. Important rules to preserve:

- A Run may hold at most one Held task (`runs.task_id`).
- `runs.has_claimed_task` is the durable signal that a Run has successfully claimed work; timeout and launch-abort logic must not rely on historical `task.claimed` events.
- A Task has exactly one Capability.
- A Task must reference an existing Scope row; the database foreign key is the integrity backstop for row existence.
- Engine prechecks require the Scope to be active and provide tagged JSON errors for missing or archived scopes.
- Scopes carry an optional `description` field for operator context; set via `--description` on `scope upsert`, surfaced in `scope list` and `briefing` output.
- Repo/worktree Scope paths are validated as directories at scope upsert and task enqueue/supersede time. The filesystem can change later, so pdx still owns launch-time runtime-path checks.
- Claim authorization is enforced by seeded `agent_claims`.
- Every successful Claim increments `attempts`, `claim_sequence`, and `fencing_token` together; `attempts` is the resettable retry/dead-letter budget counter, while `claim_sequence` is lifetime audit identity for replay-safe gate releases and late-growth markers.
- Enqueue authorization is enforced by seeded `agent_enqueues`.
- `after` edges are satisfied only by upstream Tasks in `done`.
- `about` and `repair` edges are non-blocking provenance; `about` supports normal escalation context, while `repair` points at broken work for Task Replay, Supersession, replan, or cancellation.
- After a `gate` releases for a Claim sequence, adding `after`/`about`/`repair` growth under that released branch or superseding a released/current branch member fails while any impacted downstream task is non-terminal; terminal-only impact is allowed and recorded in `task_gate_late_growth_markers`. Gate release identity is the lifetime `claim_sequence`; `attempts` is retry-cycle metadata.
- Supersessions preserve history while replacing work with a fresh Task.
- Replay is a fenced Pandora-held Repair Alert resolution that resets a failed, dead-lettered, or cancelled target Task to queued zero state while preserving history, completing the held Repair Alert, and emitting `task.replayed` plus the Repair Alert's normal `task.completed` event.
- Replay preserves the Task id, body, Scope, Capability, `max_attempts`, `claim_sequence`, edges, Artifacts, Events, Runs, Supersession history, and gate-release audit snapshots; it resets `attempts` to `0`, increments the target Fencing token, and clears completion/result state.
- Fencing tokens invalidate stale task writes.
- Cleanup is for confirmed natural Run death; Interrupt is for deliberate Kill of a live Run; Cancel is for non-held Task abandonment.
- Event history is retention-managed data, not an invariant store. `pruneEvents` deletes heartbeat events older than 1 day and other events older than 7 days using strict older-than cutoffs.

## Environment and runtime files

Required for normal CLI execution:

```sh
export PITHOS_DB=/path/to/pithos.sqlite
```

Optional for Agent commands and Artifact Contracts:

```sh
export PITHOS_RUN_ID=run_...
export PDX_USER_DATA_DIR=/path/to/pdx-user-config
```

When `PDX_USER_DATA_DIR` is unset, Artifact Contracts are disabled. When it is set, Pithos loads `$PDX_USER_DATA_DIR/artifacts.toml` if present; malformed present config fails loudly.

Use isolated DBs for development and smoke tests:

```sh
export PDX_DATA_DIR="$(mktemp -d)/pdx"
export PITHOS_DB="$PDX_DATA_DIR/pithos.sqlite"
mkdir -p "$PDX_DATA_DIR"
pnpm --filter @pdx/pithos start -- init --fresh
```

## Development

```sh
pnpm --filter @pdx/pithos typecheck
pnpm --filter @pdx/pithos test
pnpm --filter @pdx/pithos start -- --help
pnpm --filter @pdx/pithos start -- --help-json
```

Basic isolated CLI check:

```sh
export PITHOS_DB="$(mktemp -d)/pithos.sqlite"
pnpm --filter @pdx/pithos start -- init --fresh
pnpm --filter @pdx/pithos start -- scope list
```

Prefer real isolated SQLite fixtures for behavior tests. Do not replace DB invariant tests with broad mocks.
