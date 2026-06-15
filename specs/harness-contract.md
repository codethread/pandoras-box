# Harness Contract

**Status:** Implemented
**Last Updated:** 2026-06-14

## 1. Overview

### Purpose

Pandora's Box treats a **Harness** as the replaceable AI runtime that executes an Agent prompt. The Control plane supports Claude Code and Pi today, but the durable contract is not those specific CLIs: it is the set of behavior Spawner and pdx require from any runtime that wants to host Pandora, Greed, Envy, Toil, or War.

This spec defines the Harness boundary at contract level. Harness-specific argv flags, log path conventions, prompt-delivery mechanics, and parser details live in `packages/spawner` documentation and tests.

### Goals

- State what a Harness **must** provide for Pandora's Box to supervise Agent runs safely.
- Separate required behavior from beneficial behavior that improves operator experience but is not required for correctness.
- Keep task assignment, graph policy, lifecycle finalization, and repair routing outside the Harness.
- Preserve the replaceable-Harness architecture without baking Claude- or Pi-specific mechanics into domain specs.

### Non-Goals

- No exact Claude/Pi argv schema, permission flag inventory, or log file path algorithm.
- No transcript parser schema for a particular vendor log format.
- No Harness authorization model: Pithos owns Agent kinds, Capabilities, Claims, Fencing tokens, and enqueue rules.
- No Control-plane backend contract beyond the current need to launch HITL sessions in tmux.
- No requirement that every Harness support both AFK and HITL mode; Spawner may support a Harness for only the modes it can satisfy.

## 2. Design Decisions

- **Decision:** The Harness is an execution runtime, not a work scheduler.
  - **Rationale:** Agents must claim and mutate Tasks through Pithos so fencing, graph invariants, Artifacts, and Repair Alerts remain durable and auditable.

- **Decision:** Spawner adapts Harness-specific launch/log mechanics behind one rendered-run contract.
  - **Rationale:** pdx should supervise by Run metadata, process/tmux liveness, and transcript availability rather than vendor-specific CLI details.

- **Decision:** Requirements are split into **must** and **beneficial**.
  - **Rationale:** Some properties are necessary for correctness and fail-loud operation; others improve debugging, ergonomics, or future portability but should not block support for a useful Harness.

- **Decision:** Harness launch/config failures are not Task failures by themselves.
  - **Rationale:** A missing binary, invalid model, or malformed Harness configuration is an operator/configuration problem unless pdx identifies a Task-specific launch precondition failure such as a missing repo/worktree cwd.

- **Decision:** Rendered Agent prompts should not depend on task bodies being injected at launch.
  - **Rationale:** Prompt memory is not the work source of truth. The launched Agent receives operating instructions and self-claim context, then reads the current Task through Pithos.

## 3. Required Harness Contract

A Harness integration is supported for a mode only when Spawner can provide all required behavior for that mode.

### Common requirements for every supported mode

| Requirement                 | Contract                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt acceptance           | The Harness must accept a rendered Agent operating prompt at startup, either as a system prompt or appended system instruction.                                                       |
| Initial instruction         | The Harness must accept a small launch instruction that tells the Agent how to begin, separate from durable Task content.                                                             |
| CWD selection               | The Harness must launch in the cwd chosen by pdx for the Run's Scope. For repo/worktree work, that cwd must be meaningful to the Harness and its tools.                               |
| Stable run correlation      | Spawner must be able to correlate the launched Harness session with the Pithos Run by storing stable Harness session metadata on the Run.                                             |
| Loud launch failure         | Binary/config/model/permission/startup failures must surface as tagged Spawner/pdx failures rather than being silently ignored or converted into Task completion.                     |
| Parseable transcript source | The Harness must write or expose enough session history for Spawner to render an operator transcript later. Missing, corrupt, or message-less transcript data fails loudly.           |
| Non-ownership of work state | The Harness must not be the source of truth for Task assignment, completion, failure, retry, repair, or graph relationships. Agents perform those operations through Pithos commands. |
| Deterministic launch config | Spawner must be able to construct argv/env from explicit config without shell discovery, implicit interactive prompts, or hidden local defaults that change the Agent's authority.    |

### AFK-mode requirements

| Requirement              | Contract                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Process lifecycle signal | The Harness must run as a process whose exit can be observed by pdx as the AFK lifecycle signal.                                               |
| Headless start           | The Harness must begin work without operator input after launch.                                                                               |
| Completion behavior      | The Agent is expected to claim and process one Task, then complete/fail it and exit. pdx finalizes the Run only after observing process death. |
| Output capture           | pdx/Spawner must be able to capture enough stdout/stderr or session-log evidence to diagnose natural death and launch failure.                 |

### HITL-mode requirements

| Requirement              | Contract                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interactive hosting      | The Harness must run inside the current Control-plane backend, currently tmux, so an operator can attach or switch to it.                                     |
| Long-lived idle          | The Harness may remain live while waiting for the operator; idleness is not failure for Pandora and is only reaped for non-Pandora sessions under pdx policy. |
| External prompt delivery | Spawner must be able to deliver the rendered Agent prompt without requiring pdx to inject Task bodies or later messages.                                      |
| Session navigation       | pdx must be able to map a live Run or held Task to the interactive session target for `show`-style operator navigation.                                       |

## 4. Beneficial Harness Properties

These properties improve usability, debuggability, or safety, but they are not required for the core contract when Spawner can compensate or when the mode does not need them.

| Beneficial property                      | Why it helps                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Native session id flag                   | Lets Spawner choose a Harness session id that directly matches Pithos Run metadata.                                  |
| Structured JSONL logs                    | Makes transcript rendering robust across Harness versions and easier to fail loudly when schemas drift.              |
| Distinct user/assistant/tool event types | Lets transcripts show readable conversation while summarizing tool-only activity.                                    |
| Explicit model and tool argv             | Makes preview and launch plans auditable before starting a Run.                                                      |
| Permission/tool restriction controls     | Lets user config express local safety policy without editing bundled prompts.                                        |
| Append-system-prompt mode                | Allows Pandora's Box instructions to coexist with Harness-native defaults when replacement is unsafe or undesirable. |
| Stable project/session log buckets       | Makes post-run forensics possible even after pdx restarts.                                                           |
| Non-interactive validation mode          | Lets preview or smoke checks detect bad Harness config before `pdx open` starts supervision.                         |
| Clear stderr on startup failure          | Improves `pdx open` diagnostics and Repair Alert/operator guidance.                                                  |
| Tool-call progress events                | Lets transcripts explain in-flight or interrupted work without relying on raw tmux capture.                          |

## 5. Boundary with Pandora's Box Components

### Spawner owns Harness adaptation

Spawner renders prompts, validates Harness config, constructs argv/env, launches AFK processes or HITL sessions, computes expected transcript metadata, and parses Harness logs for operator transcripts. Harness-specific differences are normalized behind Spawner's rendered-run and launch-result contracts.

### pdx owns supervision policy

pdx starts and stops live resources, maintains the Registry, observes process/tmux liveness, calls Pithos Cleanup/Interrupt/timeout/launch-abort transitions, emits Supervisor logs, and routes broken work to Pandora through Repair Alerts. pdx treats Spawner launch failures as supervisor/configuration failures unless a Task-specific launch precondition transition applies.

### Pithos owns durable work state

Pithos owns Tasks, Runs, Claims, Fencing tokens, Artifacts, Events, typed Task edges, Supersessions, Task Replay, and Repair Alerts. Harness sessions do not claim durable authority merely by existing; Agents must use Pithos commands with the Run id and Fencing token supplied through launch context and claim output.

## 6. Open Questions

- Should future Harness integrations declare supported modes explicitly in user config, or should Spawner infer support from Harness kind?
- Should Harness transcript capability be validated at preview time, or only when an operator requests `pdx run transcript`?
