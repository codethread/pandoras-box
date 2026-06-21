# Harness Contract

**Status:** Implemented
**Last Updated:** 2026-06-21

## 1. Overview

### Purpose

Pandora's Box treats a **Harness** as the replaceable AI runtime that executes an Agent prompt. The Control plane supports Claude Code and Pi for normal use today, plus a private test-only fake Harness (`fagent`) for deterministic package and Podman integration tests. The durable contract is not any specific CLI: it is the small set of runtime capabilities Spawner and pdx need in order to host Pandora, Greed, Envy, Toil, or War without lying to Pithos about where work is happening or which Run is doing it.

This spec defines the Harness boundary at contract level. Harness-specific argv flags, dynamic-skill mechanisms, log path conventions, prompt-delivery mechanics, and parser details live in `packages/spawner` documentation and tests.

### Goals

- Keep the **must** contract small: only behavior required for correct Pithos/control-plane operation belongs there.
- Explain why each required behavior exists, with light references to the specs that depend on it.
- Separate Harness runtime capabilities from Spawner/pdx adapter obligations.
- Name beneficial Harness affordances, such as dynamic skills, without making them portability blockers.
- Keep task assignment, graph policy, lifecycle finalization, and repair routing outside the Harness.
- Preserve the replaceable-Harness architecture without baking Claude- or Pi-specific mechanics into domain specs.

### Non-Goals

- No exact Harness argv schema, permission flag inventory, dynamic-skill flag syntax, or log file path algorithm.
- No transcript parser schema for a particular vendor log format.
- No Harness authorization model: Pithos owns Agent kinds, Capabilities, Claims, Fencing tokens, and enqueue rules.
- No attempt to specify non-coding or non-agent runtimes. A supported Harness is assumed to be a coding-agent style runtime that can take instructions, use tools, and continue until the Agent completes or waits.
- No Control-plane backend contract beyond the current need for pdx to host HITL sessions in a local interactive backend.
- No requirement that every Harness support both AFK and HITL mode; Spawner may support a Harness only for the modes it can satisfy.

## 2. Design Decisions

- **Decision:** The Harness contract focuses on scriptable launch/configuration surfaces.
  - **Rationale:** Coding Harnesses broadly behave as "prompt an LLM, let it use tools, repeat until completion or waiting". Pandora's Box only needs to specify the launch/config/session hooks Spawner and pdx depend on, not re-specify the internal agent loop.

- **Decision:** The hard Harness contract is intentionally narrow.
  - **Rationale:** Over-specifying transcripts, diagnostics, backend hosting, or argv details as Harness requirements would make useful integrations look invalid even when Spawner/pdx can adapt them safely.

- **Decision:** Spawner adapts Harness-specific launch/log mechanics behind one rendered-run contract.
  - **Rationale:** pdx should supervise by Run metadata, resource liveness, and recorded launch/session metadata rather than vendor-specific CLI details.

- **Decision:** Requirements are split into **must**, **adapter obligations**, and **beneficial** properties.
  - **Rationale:** Some properties are necessary for correctness; some are obligations of the Spawner/pdx integration; others improve debugging, ergonomics, context management, or future portability.

## 3. Minimal Required Harness Capabilities

A Harness integration is supported for a mode only when the Harness and its Spawner adapter can provide the required capabilities for that mode.

### Common musts for every supported mode

| Requirement            | Contract                                                                                                                                                                                                                | Why Pandora's Box needs it                                                                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agentic coding loop    | The Harness must follow conventional agentic coding Harness semantics: receive prompt/instruction, use available tools to do work, then either continue with the next prompt, wait for HITL input, or exit in AFK mode. | Pandora's Box is not trying to adapt arbitrary chatbots or non-coding runtimes. The bundled prompts and policy assume a coding Agent that can act on instructions and use tools.                                             |
| Startup prompt channel | The Harness must accept the rendered Agent operating prompt plus an initial launch instruction at startup. The exact delivery mechanism is Harness-specific.                                                            | The prompt carries the Pithos operating contract: claim through Pithos, respect Fencing tokens, inspect graph context, and complete/fail held work. Without this, an Agent may act outside [task-graph.md](./task-graph.md). |
| Caller-selected cwd    | The Harness must be launchable in the cwd selected by pdx for the Run's Scope, and its tools must treat that cwd as the working directory.                                                                              | Scope is part of durable work context. Repo/worktree Tasks must execute where their Scope says they execute; otherwise the Task graph records a false location for the work.                                                 |
| Stable run correlation | The Harness or adapter must expose enough stable process/session identity for Spawner to bind the launch to one Pithos Run and recover the same association for later supervision surfaces.                             | pdx needs Run-to-resource correlation for cleanup, kill, HITL navigation, transcripts, and audit as described in [control-plane-supervision.md](./control-plane-supervision.md).                                             |

### AFK-mode musts

| Requirement                 | Contract                                                                                                                            | Why Pandora's Box needs it                                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headless start              | If the Harness is supported for AFK mode, it must begin from the startup prompt/instruction without operator interaction.           | AFK Agents are spawned to clear claimable work while the user is away. Interactive startup would let work appear supervised while no Agent can claim or complete it.        |
| Observable lifecycle signal | If the Harness is supported for AFK mode, the adapter must give pdx an observable resource lifecycle signal, normally process exit. | pdx finalizes Runs only after observing or confirming resource death. Without an observable lifecycle signal, Cleanup and no-claim timeout policy cannot be applied safely. |

### HITL-mode musts

| Requirement                  | Contract                                                                                                                                                            | Why Pandora's Box needs it                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Hostable interactive session | If the Harness is supported for HITL mode, the adapter must be able to host it in pdx's current interactive backend and keep a stable target for that live session. | Pandora and Greed are human-in-the-loop roles. Operators must be able to talk to the live Agent while pdx still supervises the associated Run. |
| Long-lived session support   | If the Harness is supported for HITL mode, it must remain live while waiting for operator input. Later HITL input goes to the same live target.                     | HITL idleness can be normal human wait time, especially for Pandora. pdx owns the policy for when non-Pandora HITL sessions are reaped.        |

## 4. Spawner/pdx Adapter Obligations

These are required for a supported Pandora's Box integration, but they are not intrinsic Harness capabilities. They describe what Spawner and pdx must do with whatever interface the Harness provides.

| Obligation                           | Contract                                                                                                                                                                                                              | Why it belongs here                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deterministic launch construction    | Spawner constructs argv/env from explicit bundled/user config and launch context, then records the effective launch plan for preview and pdx Run metadata.                                                            | Determinism is owned by `agents.toml` parsing and Spawner rendering ([agent-configuration.md](./agent-configuration.md)), not by the external Harness implementation. |
| Tagged launch-failure propagation    | Spawner/pdx surface binary/config/model/permission/startup failures as tagged failures and must not convert them into Task success or Task failure.                                                                   | A Harness may only expose process exit, stderr, or thrown launch errors. Classification and Pithos safety are Spawner/pdx responsibilities.                           |
| Transcript capability classification | For integrations advertised as transcript-capable, Spawner must know how to locate and parse enough session history for `pdx run transcript`; unsupported, missing, corrupt, or message-less transcripts fail loudly. | Transcript rendering is operator observability. The Harness provides history; Spawner owns parser knowledge and failure behavior.                                     |
| HITL navigation                      | pdx maps live Runs and held Tasks to interactive backend targets for `show`-style navigation.                                                                                                                         | Navigation follows from stable run correlation plus Registry/backend metadata; it is not a separate Harness authority.                                                |

## 5. Beneficial Harness Properties

These properties improve usability, debuggability, context management, or safety, but they are not required for core correctness when Spawner can compensate or when the mode does not need them.

| Beneficial property                        | Why it helps                                                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dynamic skills or scoped skill directories | Let users keep the base prompt small and load role/project-specific procedures only when needed, avoiding context bloat. This may be exposed through Harness-specific argv such as per-Agent skill directory flags. |
| Native session id flag                     | Lets Spawner choose a Harness session id that directly matches Pithos Run metadata instead of deriving correlation indirectly.                                                                                      |
| Structured JSONL logs                      | Makes transcript rendering robust across Harness versions and easier to fail loudly when schemas drift.                                                                                                             |
| Distinct user/assistant/tool event types   | Lets transcripts show readable conversation while summarizing tool-only activity.                                                                                                                                   |
| Explicit model and tool argv               | Makes preview and launch plans auditable before starting a Run.                                                                                                                                                     |
| Permission/tool restriction controls       | Lets user config express local safety policy without editing bundled prompts.                                                                                                                                       |
| Append-system-prompt mode                  | Allows Pandora's Box instructions to coexist with Harness-native defaults when replacement is unsafe or undesirable.                                                                                                |
| Stable project/session log buckets         | Makes post-run forensics possible even after pdx restarts.                                                                                                                                                          |
| Diagnostic evidence streams                | Stdout/stderr tails or Harness session evidence improve Repair Alert bodies and operator diagnostics.                                                                                                               |
| Non-interactive validation mode            | Lets preview or smoke checks detect bad Harness config before `pdx open` starts supervision.                                                                                                                        |
| Clear stderr on startup failure            | Improves `pdx open` diagnostics and Repair Alert/operator guidance.                                                                                                                                                 |
| Tool-call progress events                  | Lets transcripts explain in-flight or interrupted work without relying on raw tmux capture.                                                                                                                         |

## 6. Boundary with Pandora's Box Components

### Spawner owns Harness adaptation

Spawner renders prompts, validates Harness config, constructs argv/env, launches AFK processes or HITL sessions, computes expected transcript metadata when available, and parses Harness logs for operator transcripts when the integration supports them. Harness-specific differences are normalized behind Spawner's rendered-run and launch-result contracts.

### pdx owns supervision policy

pdx starts and stops live resources, maintains the Registry, observes process/session liveness, calls Pithos Cleanup/Interrupt/timeout/launch-abort transitions, emits Supervisor logs, and routes broken work to Pandora through Repair Alerts. pdx treats Spawner launch failures as supervisor/configuration failures unless a Task-specific launch precondition transition applies.
