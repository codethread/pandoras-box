# Task Plans

## Problem statement / MVP goal

The completed first plan implemented the scoped `review` capability change. The completed second plan implemented the typed-edge Task graph redesign now folded into `specs/task-graph.md` and `specs/control-plane-supervision.md`. The completed graph-map refinement made readable `pithos graph inspect` a relationship map.

The current MVP implements the Agent policy configuration model captured in `specs/agent-configuration.md`: bundled prompts remain the fixed Pithos operating foundation, while user-owned policy packs selected from `<user-data-dir>/agents.toml` add workflow preferences. The change removes template/appends/scoped-directory/project `.pdx` prompt customization in favor of a central policy registry plus path/glob match rules.

## Important references

- `specs/agent-configuration.md` — canonical policy-pack configuration model, prompt composition contract, match rules, Harness fields, hooks, and testing expectations.
- `specs/agent-command-reference.md` — generated command-card boundary that remains part of bundled prompt rendering.
- `specs/control-plane-supervision.md` — pdx/Spawner lifecycle and hook supervision context.
- `resources/user-data-dir/PANDORA.md` — installed user-facing policy registry and machine config reference.
- `resources/README.md` — resource ownership map and documentation boundary.
- `packages/spawner/src/manifest.ts` — current manifest parsing, layering, template resolution, hook loading, and Harness merge implementation to replace.
- `packages/spawner/src/spawner.ts` — prompt render, generated command cards, Harness argv/env, and preview provenance.
- `packages/spawner/src/paths.ts` — data-dir/user-dir and resource path helpers.
- `packages/spawner/src/spawner.test.ts` — existing config/render tests to adapt.
- `packages/pdx/test/substrate.test.ts` — seeded resource and lifecycle tests.
- Earlier completed review-capability, typed-edge, graph-map, and replay references remain in the Developer Notes history below.

## Task strategy

Tasks 1–20 are complete and belong to earlier plans.

Tasks 21–26 implement the Agent policy configuration model as AFK slices. Task 21 locks bundled prompt rendering and removes implicit template/appends/scope/project customization. Task 22 adds named user policy packs and user-wide/Agent-specific selection. Task 23 adds ordered path/scope/agent match rules. Task 24 centralizes hook config under the user manifest. Task 25 aligns seeded user docs and package docs. Task 26 verifies the integration with focused tests, full validation, and isolated preview smokes.

No HITL slices are required: the target behavior is captured in `specs/agent-configuration.md`, and the user explicitly requested a breaking change with no migration/back-compat work.

## Developer Notes

Append notes here. Do not rewrite earlier notes.

### Policy configuration task plan amendment — 2026-05-30

- Added Tasks 21–26 for the policy-pack configuration model.
- This plan intentionally removes implicit prompt shadowing, user `template`/`includes`/`appends`, scope-directory config, project-local `.pdx` config, and scoped/project hook config from the active implementation path.
- The customization surface is named policy packs selected from `<user-data-dir>/agents.toml` with `add`/`remove` and ordered match rules. Do not add migration or compatibility behavior unless the spec changes.

### Task 20 verification — 2026-05-26

- Focused Pithos replay/claim-sequence coverage passed: `pnpm --filter @pdx/pithos test -- test/foundation.test.ts test/chain-policy.test.ts test/task-lifecycle.test.ts test/render.test.ts test/cli.test.ts`.
- Focused Spawner Pandora command-card/prompt coverage passed: `pnpm --filter @pdx/spawner test -- --run`.
- Isolated SQLite CLI smoke passed with temp `PITHOS_DB`. Repro outline used:
  ```sh
  SMOKE_ROOT="$(mktemp -d)"
  export PITHOS_DB="$SMOKE_ROOT/pithos.sqlite"
  REPO_DIR="$SMOKE_ROOT/repo"; mkdir -p "$REPO_DIR"
  PITHOS="pnpm --silent --filter @pdx/pithos start --"
  $PITHOS init --fresh
  SCOPE_ID="$($PITHOS scope upsert --kind repo --path "$REPO_DIR" | jq -r '.scope.id')"
  $PITHOS run upsert --run run_toil_smoke --agent toil --mode afk --scope global --cwd "$PWD" --harness-kind system --session-log-path "$SMOKE_ROOT/toil.jsonl" --session-id session-toil
  $PITHOS run upsert --run run_war_smoke --agent war --mode afk --scope "$SCOPE_ID" --cwd "$REPO_DIR" --harness-kind system --session-log-path "$SMOKE_ROOT/war.jsonl" --session-id session-war
  $PITHOS run upsert --run run_pandora_smoke --agent pandora --mode hitl --scope global --cwd "$PWD" --harness-kind system --session-log-path "$SMOKE_ROOT/pandora.jsonl" --session-id session-pandora
  TASK_ID="$(printf 'Replay smoke target body\n' | $PITHOS task enqueue --run run_toil_smoke --scope "$SCOPE_ID" --capability execute --title "Replay smoke target" --stdin | jq -r '.task.id')"
  TARGET_TOKEN="$($PITHOS task claim --run run_war_smoke --scope "$SCOPE_ID" --capability execute | jq -r '.task.token')"
  $PITHOS task fail "$TASK_ID" --run run_war_smoke --token "$TARGET_TOKEN" --reason "smoke intentional failure"
  ALERT_CLAIM_JSON="$($PITHOS task claim --run run_pandora_smoke --scope global --capability escalate)"
  ALERT_ID="$(printf '%s' "$ALERT_CLAIM_JSON" | jq -r '.task.id')"
  ALERT_TOKEN="$(printf '%s' "$ALERT_CLAIM_JSON" | jq -r '.task.token')"
  $PITHOS task replay "$TASK_ID" --run run_pandora_smoke --token "$ALERT_TOKEN" --reason "smoke replay after fixed precondition"
  test "$($PITHOS task inspect "$TASK_ID" --json | jq -r '.task.status')" = queued
  test "$($PITHOS task inspect "$TASK_ID" --json | jq -r '.task.attempts')" = 0
  test "$($PITHOS task inspect "$ALERT_ID" --json | jq -r '.task.status')" = done
  ```
- Full repository validation passed: `pnpm verify`.
- No replay integration repairs or caveats were needed.

### Task 19 documentation — 2026-05-26

- Folded Task Replay into canonical Task graph docs, including replay validation, reset/preserve semantics, replay events, `claim_sequence`, and gate-release identity by claim sequence.
- Updated control-plane and ubiquitous-language guidance so Repair Alerts prefer Task Replay for valid same-Task retries and Supersession/replan/cancel when the work definition changes or should not continue.
- Updated the Pithos package README with the replay CLI surface and schema/invariant notes, removed the active replay planned-spec entry from `specs/README.md`, and removed the temporary `specs/task-replay.md` change spec after fold-in.
- Validation: `pnpm verify` passed.

### Task 18 implementation — 2026-05-26

- Updated Pandora Repair Alert guidance to choose replay for valid same-Task retries after execution-context/external-precondition failures, and to keep Supersession for changed body, assumptions, scope, or plan.
- Pandora guidance now states she must claim the Repair Alert first, use the held alert fencing token for `pithos task replay`, and that replay completes the alert while resetting the affected Task to queued with a fresh retry budget.
- Generated command cards now omit `pithos task replay` for non-Pandora agents while including Pandora-only replay notes in Pandora's command reference.
- Validation: focused Spawner tests and `pnpm verify` passed.

### Task 17 implementation — 2026-05-26

- Added `pithos task replay <target-task-id> --token <repair-alert-token> --reason <text> [--run <run-id>]` with JSON output from the Engine replay transition.
- Replay uses the existing PITHOS_RUN_ID/`--run` resolution path and adds tagged pre-parse validation for missing/empty replay reasons so stdin stays out of the command.
- CLI regression coverage exercises real SQLite replay through interrupt-created Repair Alerts, env/default run resolution, conflicting run ids, missing/empty reason, stale token, mismatched Repair Alert target, and help-json metadata.
- Validation: focused Pithos CLI tests and `pnpm verify` passed.

### Task 16 implementation — 2026-05-26

- Added the Engine-only replay transition for Pandora-held Repair Alerts; CLI and prompt guidance remain for later slices.
- Replay validates Pandora ownership, held Repair Alert fencing, matching `repair` edge, target status/scope/canonicality, and non-empty reason inside one transaction.
- Successful replay resets the target Task to queued operational zero state while preserving `claim_sequence`, `max_attempts`, artifacts, edges, and prior events; the held Repair Alert is completed and cleared from Pandora's run.
- Regression coverage exercises failed/dead-letter/cancelled target replay and the required fail-loud rejection paths.
- Validation: focused Pithos lifecycle tests, typecheck, and lint passed during implementation.

### Task 15 implementation — 2026-05-26

- Gate release rows and member rows are now keyed by lifetime `claim_sequence`; `attempt` remains stored as descriptive retry-cycle metadata.
- Claim-time release events include both `claim_sequence` and `attempt`; late-growth markers reference `gate_claim_sequence` and render claim-sequence identity with attempt in parentheses.
- Regression coverage proves a gated task can be reclaimed and then manually replay-shaped by resetting attempts, producing release identities `(1, attempt 1)`, `(2, attempt 2)`, and `(3, attempt 1)` without collision.
- Validation: `pnpm verify` passed.

### Task 14 implementation — 2026-05-26

- Added fresh-schema `tasks.claim_sequence` and surfaced it through decoded Task detail / inspect JSON at the Engine boundary.
- Successful claims now increment `attempts`, `claim_sequence`, and `fencing_token` together in the claim update; gate-release identity remains keyed by `attempt` for the next slice.
- Regression coverage proves first claim increments both counters and cleanup dead-letter decisions still use `attempts` versus `max_attempts`, independent of `claim_sequence`.
- Validation: `pnpm verify` passed.

### Task Replay task plan amendment — 2026-05-26

- Added Tasks 14–20 for the Task Replay MVP captured in `specs/task-replay.md`.
- The plan intentionally treats replay as a Pandora-held Repair Alert resolution, not a worker retry mechanism.
- The schema work assumes alpha DB recreation: do not add legacy migration/rebuild branches for pre-`claim_sequence` databases.
- Deep review split the original broad claim identity task into Task 14 (`claim_sequence` counter on claim) and Task 15 (gate-release/late-growth identity by claim sequence), moved replay implementation to Task 16, and clarified CLI vs Pandora command-card ownership.

### Task 13 documentation — 2026-05-20

- Folded the graph-map renderer diff spec into canonical Task graph and Pithos package docs.
- Clarified that readable `graph inspect` is map-oriented; task bodies, Artifacts, next-action hints, and agenda/sitrep summaries remain with `task inspect` / `briefing`.
- Removed `specs/task-graph-map-renderer-diff-spec.md` and its specs index entry after fold-in.
- Validation: `pnpm verify` passed.

### Task 12 implementation — 2026-05-20

- Refined readable `pithos graph inspect` output with the graph-map header, selector label, durable edge-direction/layout notes, and legend.
- Incoming map rows now label `after`, `about`, `repair`, and `gate [state]` edges with `←`; Supersession renders separately as `↻ replaced-by` history.
- Gate rows now render explicit member blocks (`branch members: all clear`, `open members:`, `broken members:`) with canonical member notes only when ids differ.
- Updated renderer, CLI, lifecycle snapshots/expectations; validation passed with `pnpm verify`.

### Graph map refinement task plan amendment — 2026-05-20

- Added Tasks 12–13 for the approved `pithos graph inspect` relationship-map refinement.
- The implementation scope is intentionally renderer/snapshot/docs only: no named views, no `--view`, no held/current-run marker, no sitrep, no next-action hints, no task body or artifact summaries, and no JSON contract changes.
- The diff spec is tracked in VCS at `specs/task-graph-map-renderer-diff-spec.md`; Task 13 folds the relevant boundary language into canonical docs/specs after Task 12 establishes the renderer contract.

### Task 9 implementation — 2026-05-20

- Added typed `gate` graph edges with inspection state/members, scope graph closure over `after`/`about`/`repair` branch membership plus `gate` coordination edges, and late-growth marker visibility in task/graph output.
- Readable task/graph/briefing output now separates direct after blockers, attached about/repair context, coordination gates, broken/open gate members, Supersession, and allowed late branch growth.
- Added renderer snapshots for major typed-edge graph display variants and DB-backed coverage proving scoped repo graph inspection pulls attached global attention/checkpoint tasks.
- Simplification pass kept late-growth output as the existing parsed DB row shape instead of adding a parallel DTO/mapper.
- Validation: `pnpm verify` passed.

### Task 8 implementation — 2026-05-20

- Added `task_gate_late_growth_markers` and a public Pithos read-model helper for marker rows with gate release, mutation, actor, and timestamp fields for Task 9 rendering.
- Edge insertion for `after`/`about`/`repair` and Supersession now checks affected released gates in the same SQLite transaction, fails loudly while downstream impact closure has non-terminal tasks, and records markers when impact is terminal.
- Regression coverage added for direct released gates, transitive released gates, Supersession under released gates, allowed terminal late growth marker writes, and rollback of failed late edge attempts.
- Validation: `pnpm verify` passed.

### Task 7 implementation — 2026-05-20

- Added explicit `--gate-on` enqueue support and `gate` edge insertion with duplicate/current-target validation.
- Claimability now canonicalizes superseded `after` targets and evaluates queued tasks against dynamic gate branch closures over incoming `after`/`about`/`repair` edges; gate states are exposed in task inspect read-model output as `clear`, `open`, or `broken`.
- Claim writes per-attempt `task_gate_releases` and `task_gate_release_members` rows in the Claim transaction and emits `task.gate_released` with attempt, fencing token, run id, and member snapshot ids.
- Enqueue graph integrity now rejects gate owners already inside target closure and blocking cycles across `after`/`gate`; Supersession retargets queued `after` and `gate` dependents by kind.
- Held checkpoint escalation continuation now follows the existing held-escalation continuation path by treating held `gate` escalation as chain-source-like for policy resolution.
- Validation: `pnpm verify` passed.

### Task 6 implementation — 2026-05-20

- Public enqueue now exposes typed non-gate edge flags: repeatable `--after`, singular `--about`, and pdx-system-only `--repair`; the old `--depends-on` flag and `--chain source` policy are rejected.
- Automatic chain policy now writes typed edges: ordinary continuations use `after`, ordinary-to-escalation uses `about`, about-escalation continuations depend on the held escalation, and repair-escalation continuation fails loudly with supersede/replan/cancel guidance.
- Enqueue validates duplicate `after` targets, superseded edge targets, mutually exclusive attention edges, and branch-membership acyclicity across `after`/`about`/`repair` inside the creation transaction.
- CLI/help/tests were updated for the new edge surface; pdx call sites now pass `after` to the Engine boundary.
- Smoke checks used an isolated real SQLite DB and real Pithos CLI commands for `--after`, `--about`, system `--repair`, removed flag rejection, removed chain policy rejection, and help JSON.
- Validation: `pnpm verify` passed.

### Task 5 implementation — 2026-05-20

- Fresh Pithos schema now stores dependencies/provenance in `task_edges` with `after`, `about`, `repair`, and `gate` kinds; `task_dependencies` and `task_sources` are no longer created.
- Existing public enqueue flags are preserved for this storage slice: `--depends-on` writes `after`, automatic escalation provenance writes `about`, and Repair Alerts write `repair`.
- Claimability still checks only unresolved outgoing `after` edges; `gate` storage is present but intentionally inert until the gate claimability slice.
- Supersession rewires queued direct `after` dependents to replacements and keeps `about`/`repair` provenance attached to the original task.
- `task.created` payloads now include `edges: { after, about, repair, gate }`; legacy `depends_on_task_ids`/source payload fields were removed from new events.
- YAGNI follow-up removed premature gate-release tables and duplicate source fields from graph nodes; Task 5 keeps only storage needed for the tracer-bullet edge model.

### Task plan amendment — 2026-05-17

- Deep review found that adding `review` to Greed claims affects pdx launch policy and Spawner claim rendering, not only Pithos built-ins. Task 1 now explicitly includes pdx/Spawner integration and tests.
- Task 2 now carries the prompt-only scope policy, global review payload requirements, rejected-review outcome behavior, and preview validation.
- Task 3 now includes the root `README.md` in permanent docs fold-in.

### Task 1 implementation — 2026-05-17

- Added `review` as a built-in Capability, Greed claim, and Pandora/Toil enqueue target; kept Greed/War/Envy unauthorized for `review` enqueues and Pandora/Toil/War/Envy unauthorized for `review` claims.
- pdx now treats claimable `design` and `review` work as Greed launches and passes the launch-selected Capability through to Spawner.
- Spawner now requires an authorized `selectedCapability` for multi-claim agents and renders the deterministic claim command for that Capability.
- `review` uses ordinary chain-policy dependency behavior; `escalate` remains the only source-link special case.

### Task 2 implementation — 2026-05-17

- Canonical prompts now document `review` as explicitly requested Greed-owned HITL assessment, not an automatic gate.
- Greed prompt has separate design/review modes, including review readiness escalation, review-report artifact, rejected-outcome handling, and no-substantial-implementation boundary.
- Pandora and Toil prompts can enqueue requested review tasks with narrowest-useful-scope guidance and global review payload requirements.
- `pandora-spawn preview` succeeded for Greed (`review` selected), Pandora, and Toil in an isolated PDX/Pithos data configuration.
- Validation: `pnpm verify` passed. A flaky live ID format assertion was broadened to allow hyphenated word-list entries such as `yo-yo`.

### Task 3 implementation — 2026-05-17

- Folded `review` into permanent terminology and base specs as Greed-claimed, explicitly requested, ordinary non-escalation work.
- Updated control-plane docs with Greed review launch/lifecycle and readiness escalation to Pandora.
- Removed the temporary scoped review change spec from the specs index and filesystem.
- Validation: `pnpm verify` passed.

### Task 4 verification — 2026-05-17

- Isolated `pandora-spawn preview` succeeded for Greed with `--selected-capability review`, Pandora, and Toil after fresh `pithos init --fresh` and `pdx init` in temp data/user dirs.
- `pnpm verify` passed from the repo root.
- No temporary scoped review spec remains under `specs/`; no integration repairs were needed.

### Typed edge task plan amendment — 2026-05-19

- Added Tasks 5–11 for the typed-edge Task graph redesign that was initially captured in the temporary typed-edge diff spec, now folded into canonical specs.
- The plan intentionally preserves completed review tasks and appends the new work with new integer ids.
- Task 9 explicitly requires broad snapshot tests for readable `graph inspect` variations so future display changes are obvious in diffs and can be intentionally accepted with `vitest run --update`.
- Deep-review follow-up tightened standalone AFK ownership: Task 5 owns `task.created` typed-edge event payloads, Task 6 owns `after/about/repair` membership cycle tests and system-only `repair` edges, Task 7 owns checkpoint escalation continuation plus invalid gate-closure/cycle checks plus `task.gate_released`, Task 8 now requires durable `task_gate_late_growth_markers` instead of choosing between marker/event, and Task 9 renders that marker.

### Task 10 implementation — 2026-05-20

- Folded the typed-edge diff spec into canonical Task graph, control-plane, ubiquitous-language, package, resource, and agent-template docs.
- Removed the temporary typed-edge diff spec from the specs index and filesystem.
- Updated Spawner command-card annotations/tests so rendered agent prompts describe typed edges, gates, and repair context instead of removed dependency/source-link surfaces.
- Validation: `pnpm verify` passed.

### Task 11 verification — 2026-05-20

- Validation passed: `pnpm verify`; `pnpm --filter @pdx/pithos test -- test/foundation.test.ts test/chain-policy.test.ts test/task-lifecycle.test.ts test/render.test.ts test/cli.test.ts`; `pnpm --filter @pdx/pdx test -- --run`; `pnpm --filter @pdx/spawner test -- --run`.
- Isolated smoke passed with temp `PITHOS_DB`, `PDX_DATA_DIR`, and `PDX_USER_DATA_DIR`: `pithos init --fresh`, `pdx init`, Pithos help surfaces, and War/Pandora `pandora-spawn preview` typed-edge prompt checks.
- No temporary typed-edge diff spec remains in `specs/` or `specs/README.md`; no repairs or snapshot updates were needed.
