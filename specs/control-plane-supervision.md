# Control Plane Supervision

**Status:** Implemented
**Last Updated:** 2026-06-21

## 1. Overview

### Purpose

Pandora's Box is a local **Control plane** composed of three layers:

1. **Pithos** — durable state and graph invariants for Tasks, Runs, Claims, Fencing tokens, Artifacts, Events, and Repair Alerts.
2. **Spawner** — Harness launcher that renders Agent prompts, builds Harness argv/env, starts AFK processes or HITL tmux sessions, and parses Harness session logs.
3. **pdx** — local supervisor that reconciles Pithos state with live processes/tmux sessions through an in-memory Registry.

Agents claim work themselves through Pithos. pdx never injects Task content into prompts. Pandora is a long-lived HITL Agent that claims Escalation tasks and talks with the user.

### Goals

- Keep durable truth in Pithos and live resource policy in pdx.
- Keep Spawner launcher-only: prompt rendering, Harness launch, and transcript parsing.
- Start and stop the box through `pdx init`, `pdx open`, and `pdx close`.
- Maintain exactly one Pandora singleton while the box is open.
- Spawn non-Pandora Agents only for claimable work and cap them by Registry entries.
- Finalize Runs only from pdx after observing or confirming live resource death.
- Route broken chains to Pandora with durable Repair Alerts instead of hidden retries.
- Expose operator/Pandora inspection through pdx commands and Supervisor logs.
- Let users control supervisor-owned repo launch guards from scaffold-once user config without putting executable guard scripts in Agent prompts.

### Non-Goals

- No distributed or multi-host supervision.
- No persisted Registry; Pithos is durable truth, Registry is live pdx memory.
- No Same-run resurrection. Dead Agents are cleaned up; later reconcile may create a Fresh run.
- No automatic repair of failed/cancelled/dead-lettered branch work.
- No generic message injection into Harness sessions; Nudges are content-free signals paired with durable Pithos state.
- No Agent prompt or policy-pack enforcement for launch safety checks that pdx can verify before creating a Run.

## 2. Design Decisions

- **Decision:** Split durable state, launch mechanics, and supervision policy across Pithos, Spawner, and pdx.
  - **Rationale:** Each layer has a different source of truth. Mixing them causes lifecycle drift, prompt coupling, and hard-to-debug state races.

- **Decision:** pdx uses `@pdx/pithos` as a typed library, not the `pithos` CLI.
  - **Rationale:** The CLI is an Agent/operator boundary. The supervisor needs typed in-process state transitions without subprocess parsing.

- **Decision:** Spawner does not register Runs or own Kill/Cleanup/Interrupt.
  - **Rationale:** Those operations require Pithos invariants plus live Registry policy, which belong to pdx.

- **Decision:** pdx never pre-claims Tasks.
  - **Rationale:** Spawn and Claim are separate. A launched Agent claims through Pithos; if work disappeared, it sees `NO_CLAIMABLE_WORK` and exits or is cleaned up.

- **Decision:** Cleanup, Interrupt, and Cancel are distinct.
  - **Rationale:** Cleanup is for confirmed natural Run death, Interrupt is for deliberate Kill of a live Run, and Cancel is for abandoning non-held Task work.

- **Decision:** Launch-precondition failures cancel queued work and create a Repair Alert atomically.
  - **Rationale:** A missing repo/worktree cwd means the queued Task cannot launch as written. Marking it failed would imply an Agent attempted it; retrying it would loop.

- **Decision:** Repo default-branch enforcement is pdx supervisor policy, not rendered Agent policy.
  - **Rationale:** Branch safety is knowable before launch. Enforcing it in pdx prevents an Agent from starting in the wrong repository state, keeps the failure on the existing Repair Alert path, and avoids relying on prompt obedience or shell snippets.

- **Decision:** Supervisor launch policy uses a separate scaffold-once user config file instead of `agents.toml`.
  - **Rationale:** `agents.toml` is Spawner render/Harness/policy-pack configuration. Repo branch preconditions are pdx supervision behavior, so they need a pdx-owned config surface that can be seeded by `pdx init`/`pdx open` without broadening Spawner's manifest contract.

- **Decision:** Harness/config/process failures are supervisor errors, not Task cancellation.
  - **Rationale:** A missing Harness binary or malformed manifest is operator/configuration failure. User work must not be silently cancelled.

- **Decision:** Nudges are content-free and best-effort.
  - **Rationale:** Durable Pithos Tasks/Artifacts are the source of attention. A Nudge only shortens the time until Pandora checks Pithos.

## 3. Built-in Agents and Capabilities

Pithos seeds and enforces the built-in Agent kinds, Capabilities, claim authorization, and enqueue authorization.

| Agent kind | Mode today   | Claims              | Enqueues                                                       |
| ---------- | ------------ | ------------------- | -------------------------------------------------------------- |
| `pdx`      | system actor | —                   | `escalate`, `intake`                                           |
| `pandora`  | HITL         | `escalate`          | `clarify`, `triage`, `design`, `review`, `escalate`            |
| `envy`     | AFK          | `intake`, `clarify` | `clarify`, `triage`, `design`, `escalate`                      |
| `toil`     | AFK          | `triage`            | `clarify`, `triage`, `design`, `execute`, `review`, `escalate` |
| `greed`    | HITL         | `design`, `review`  | `triage`, `design`, `escalate`                                 |
| `war`      | AFK          | `execute`           | `escalate`                                                     |

Capabilities are `intake`, `clarify`, `triage`, `design`, `execute`, `review`, and `escalate`. `clarify` is Envy-owned requirements-measurement work between interpretive intake and triage; deterministic external intake remains unchanged unless Envy routes interpretive work into clarify by policy. `execute` work must be in repo/worktree Scope. `intake` and `escalate` work lives in global Scope. `review` work may be global, repo, or worktree scoped and is ordinary non-escalation work claimed by Greed. Pithos enforces the durable authorization contract; bundled prompts and user policy packs guide workflow but are not authorization truth.

## 4. pdx Lifecycle

### `pdx init`

`pdx init` prepares the data dir, initializes Pithos, creates runtime directories, materializes bundle-owned `<data-dir>/agents.toml`, `<data-dir>/templates/`, and `<data-dir>/AGENTS.md`, preserves scaffold-once `<user-data-dir>/AGENTS.md`, `<user-data-dir>/CLAUDE.md`, `<user-data-dir>/agents.toml`, `<user-data-dir>/artifacts.toml`, and `<user-data-dir>/supervisor.toml`, and re-seeds installed `<user-data-dir>/PANDORA.md`. The `artifacts.toml` scaffold contains commented recommended examples only. The `supervisor.toml` scaffold enables repo-root trunk enforcement by default. Existing user files are never overwritten. It does not touch tmux or Harness CLIs.

- normal init reuses existing state
- `--clean` removes DB, runs, and logs while preserving bundled config and user config
- `--nuke` removes pdx-owned runtime/bundled state while preserving `<user-data-dir>`
- `--clean` and `--nuke` are mutually exclusive

### `pdx open`

`pdx open` runs init behavior, fails if the `pdx--daemon` tmux session already exists, starts the daemon in tmux, waits for IPC readiness, and attaches the operator to Pandora's tmux session. The daemon settles deterministic old pdx-owned tmux/AFK leftovers, upserts the `pdx` system Run, starts Pandora, and begins reconciliation. Repair Alert handling drives Pandora's existing pane; replacing it with `tmux respawn-pane` would be Same-run resurrection.

### Reconcile tick

Each tick settles lifecycle before spawning:

1. observe Registry entries
2. Cleanup AFK/HITL resources that are gone
3. handle no-claim timeouts for non-Pandora sessions that never claimed work
4. reap non-Pandora HITL sessions after their first held Task clears
5. continue terminating Kills until resources are gone
6. run event-pruning maintenance once on startup and then at hourly cadence
7. maintain the Pandora singleton
8. send a content-free Nudge when claimable Escalation work appears
9. validate launch preconditions for one selected claimable non-Pandora Task
10. spawn at most one Agent through Spawner, in built-in order with Envy before Toil/Greed/War; claimable `design` and `review` work both launch Greed with the selected claim Capability passed to Spawner for deterministic claim-command rendering

Registry entries in `launching`, `live`, and `terminating` states count against caps. The MVP cap is one live entry per `(Agent kind, Scope)` plus the global AFK cap.

### `pdx close`

`pdx close` stops spawning, kills supervised AFK/HITL resources including Pandora, confirms they are gone, calls Pithos Cleanup for in-memory Agent runs, cleans up the `pdx` system Run last, and closes the daemon tmux session.

## 5. Greed Review Lifecycle

Greed handles `review` Tasks as requested HITL assessment: inspect the Task graph and scoped context, prepare the walkthrough, then enqueue a global `escalate` readiness Task so Pandora can route the user to Greed's live session. Greed records the outcome durably through the task/session context or an artifact when policy calls for one, then completes the review Task; rejected work is routed onward through Pandora/Toil rather than silently rewriting the chain.

## 6. Repair Alerts and Broken Chains

A **Repair Alert** is a system-authored global Escalation task with a typed `kind`. It is durable, claimable by Pandora, and paired with Pithos graph provenance when it names affected work.

Implemented kinds include:

- `interrupt` — pdx deliberately interrupted a live Held task during Kill
- `task_failed` — an Agent failed a Held task
- `dead_letter` — Cleanup exhausted Attempts for a Held task
- `launch_precondition` — queued work could not launch because its repo/worktree cwd was missing or invalid, or because the enabled repo default-branch guard rejected a repo Scope launch
- `reconciler_stuck` — repeated reconcile failures need Pandora/operator attention
- `kill_failure` — pdx could not kill a live resource after repeated attempts

Escalation routing uses typed Task edges:

| Form                  | Edge shape                        | Claimability               | Workflow meaning                                                                                                                   |
| --------------------- | --------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Immediate escalation  | `escalation --about--> target`    | immediate                  | Human attention/context about in-flight or planned work.                                                                           |
| Checkpoint escalation | `escalation --gate--> target`     | after target branch drains | Human checkpoint after successful branch completion.                                                                               |
| Repair Alert          | `repair_alert --repair--> target` | immediate                  | Broken-work repair; Pandora should replay when the same Task is still valid, otherwise supersede, replan, or intentionally cancel. |

Repair Alerts that reference one affected Task carry a `repair` edge. They do not use `after`, because failed, cancelled, and dead-lettered Tasks do not unblock downstream work. `repair` is not ordinary context: a held `repair` escalation cannot ordinary-auto-continue. Pandora repairs the Broken chain from her existing HITL session with Task Replay when the original Task definition is still valid and the failure was execution context/precondition related; otherwise she uses Supersession, explicit replanning, or intentional Cancel.

Task-failure, dead-letter, and interrupt Repair Alerts are created by Pithos in the relevant Task/Run transition. pdx owns invoking Interrupt before killing the live resource, but Pithos owns the durable Alert side effect transactionally. Launch-precondition Repair Alerts are created by a Pithos atomic transition that cancels the still-queued Task, records `repair` provenance, creates the Escalation task, and emits Events in one transaction.

### Repo default-branch launch guard

`<user-data-dir>/supervisor.toml` is user-owned scaffold-once pdx supervisor configuration. `pdx init` and `pdx open` create it when missing and preserve user edits thereafter; if the file is absent outside materialization, pdx uses the same enabled default as the scaffold. Its launch-policy field is:

```toml
[launch_preconditions]
enforce_repo_root_trunk = true
```

When enabled, pdx checks repo Scope launches before Run creation. The guard applies only to `repo` Scopes, not `global` or `worktree` Scopes. Users disable it by editing `<user-data-dir>/supervisor.toml` to set `enforce_repo_root_trunk = false`. pdx resolves the actual Git repository root from the Scope path, detects the remote default branch from local `origin/HEAD` metadata without contacting the network, and compares it with the current checked-out branch. A missing Git repository, unknown default branch, detached HEAD, or non-default current branch means the queued Task is unlaunchable as written.

The failure path is the same as other launch-precondition failures: pdx does not create a Run, Pithos atomically cancels the queued Task, and a global `launch_precondition` Repair Alert is created for Pandora. The Repair Alert body must include enough evidence for Pandora and the user to decide whether to switch branches and replay, supersede the work, or intentionally abandon it: Scope, Task, path, resolved Git root when available, current branch, expected default branch, and reason.

## 7. Kill, Cleanup, Timeout, and Launch Abort

### Cleanup

pdx calls Pithos Cleanup only after it confirms the execution resource is gone. Cleanup terminalizes the Run and, if a Held task was still active, requeues or dead-letters that Task based on Attempts/max Attempts while incrementing its Fencing token.

### Interrupt / Kill

`pdx run kill` and `pdx task kill` mutate Pithos first with Interrupt, then kill the OS process or tmux session. If a Held task was interrupted, the Pithos Interrupt transition creates an `interrupt` Repair Alert. Killing is retried on reconcile while the Registry entry remains `terminating`; repeated kill failures create a `kill_failure` Repair Alert.

### Timeout

A non-Pandora no-claim session that exceeds the bootstrap timeout is killed, confirmed gone, and terminalized as a Timed out run. No Task is mutated. This decision uses durable Run state (`runs.has_claimed_task`) rather than scanning retained `task.claimed` events.

### Event pruning maintenance

pdx invokes Pithos event pruning through the typed library boundary, not by shelling out to the `pithos` CLI.

Retention semantics:

- prune `run.heartbeat` and `task.heartbeat` events when `created_at < now - 1 day`
- prune all other event types when `created_at < now - 7 days`
- use strict older-than cutoffs so exact boundary timestamps are retained until the next eligible tick

Scheduling semantics:

- run once on the initial daemon reconcile tick after startup/open
- run again only when at least one hour has elapsed since the last successful prune in daemon memory
- log completion under Supervisor span `pdx.maintenance` with deleted counts, `last_prune_at`, and `next_due_at`

Pruning is maintenance, not invariant storage: Pithos' Run timeout/launch-abort safety must remain correct even if older `task.claimed` events have been deleted.

### Launch abort

If pdx creates a Run row but the launch cannot complete before the Agent claims work, pdx uses the Pithos launch-abort transition. The no-claim Run becomes `cancelled`, no Task is mutated by that Run transition, and launch-precondition task repair runs separately only when the original queued Task still matches expected preconditions.

## 8. Spawner Boundary

pdx-launched Agents receive `PDX_USER_DATA_DIR` so Pithos and Spawner can read user-owned Artifact Contracts. Pithos owns parsing and completion enforcement; pdx does not validate artifact requirements, keep a bundled active contract, or retroactively revalidate Tasks when config changes. Spawner renders prompt guidance through the shared Pithos parser as described in [artifact-contracts.md](./artifact-contracts.md).

pdx renders before it launches:

```text
pdx reconcile
  -> Spawner.renderAgent(input)
  -> Pithos run upsert with rendered mode, Harness kind, and session log path
  -> Spawner.launchRenderedAgent(rendered)
  -> pdx stores runtime pid/tmux metadata in Registry
```

Spawner owns:

- manifest, bundled prompt, and policy validation (contract in [agent-configuration.md](./agent-configuration.md))
- command-card rendering into prompts
- Harness argv/env construction
- expected Harness session log paths; Claude paths use the realpath-normalized launch CWD to match Claude Code's project bucket naming, and Pi launches use native `--session-id` with the Pithos Harness session id
- AFK process launch and HITL tmux launch
- Harness session transcript parsing for `pdx run transcript`

The required and beneficial behavior for replaceable Harness runtimes is defined in [harness-contract.md](./harness-contract.md). Spawner adapts Harness-specific mechanics to that contract; pdx supervises only the normalized Run/resource metadata.

Spawner does not own Pithos graph policy, live Registry state, Kill, Cleanup, Interrupt, Cancel, or Nudge policy.

## 9. External Intake Socket

When the daemon is running, pdx listens on `<data-dir>/intake.sock` for external intake events. Each connection accepts one JSON object with non-empty `title` and `body`, then creates one global `intake` Task for Envy. Invalid JSON, invalid fields, or enqueue failures return an error response to the socket client and do not create a Task.

The intake socket is always daemon-owned while `pdx open` is running. It is not configured through `agents.toml`, rules, scope directories, or project-local `.pdx` manifests. External watcher lifecycles belong to the user; pdx does not spawn, restart, or kill producer processes.

`pdx daemon status` reports the resolved `intake_socket` path. `pdx close` closes and unlinks the intake socket.

## 10. Operator and Pandora Interfaces

The public `pdx` surface is the operator/Pandora control surface:

- `pdx init`, `pdx open`, `pdx close`
- `pdx daemon status`, `pdx daemon logs`
- `pdx run kill`, `pdx run transcript`, `pdx run show`
- `pdx task kill`, `pdx task show`

All commands resolve data dir as `--data-dir`, then `PDX_DATA_DIR`, then `$HOME/.pdx`.

`pdx daemon logs` reads structured Supervisor log JSONL even after the daemon stops. These are Supervisor logs, not Harness transcripts. `pdx run transcript` reads the Pithos Run transcript metadata and delegates Harness-log parsing to Spawner for both AFK and HITL runs; Pi timeline tool-call entries are rendered as in-flight tool summaries when present. System Runs fail loudly for transcript rendering and point to Supervisor logs. Harness logs with no parseable user/assistant messages also fail loudly instead of rendering empty output. `pdx run show` and `pdx task show` are interactive-session navigation commands; AFK/headless runs intentionally have no session to show and the operator should use transcript or daemon status instead.
