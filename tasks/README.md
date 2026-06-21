# Pandora's Box AFK Plans

## Problem statement / MVP goal

Implement the Artifact Contracts MVP described by `specs/artifact-contracts.md`: user-owned artifact guidance, fenced artifact mutation, active/rejected artifact status, required-artifact completion gates, compact artifact inspection, and prompt-visible normalized contract data. The MVP intentionally enforces artifact presence only; it does not validate artifact body semantics, counts, or signed brief status.

## Important references

- `specs/artifact-contracts.md` — implemented Artifact Contract semantics and centralized config/API contract.
- `specs/task-graph.md` — implemented Task graph artifact lifecycle, completion, and inspection behavior.
- `specs/control-plane-supervision.md` — implemented pdx scaffolding/environment and `clarify` capability behavior.
- `specs/prompt-rendering.md` — implemented prompt assembly, command-card, and artifact prompt guidance behavior.
- `specs/agent-configuration.md` — implemented prompt-composition boundary for generated Artifact Contract guidance.
- `packages/pithos/README.md` — Pithos package boundaries and invariant patterns.
- `packages/spawner/README.md` — Spawner prompt rendering and preview boundary.
- `packages/pdx/README.md` — pdx user config scaffolding and lifecycle boundary.
- `packages/pithos/src/builtins.ts` — built-in capability/claim/enqueue authorization source.
- `packages/pithos/src/engine/claim-loop.ts` — claim, complete, fail, cancel, artifact add transition area.
- `packages/pithos/src/engine/task-read-model.ts` and `packages/pithos/src/engine/render.ts` — artifact read models and task/graph renderers.

## Task strategy

The plan is sliced so Pithos foundations land before cross-package prompt/scaffold integration. Clarify capability plumbing is included because the spec uses clarify as the motivating lane, but the core Artifact Contract parser/enforcement path can be proven on existing capabilities and is not blocked by clarify. Capability plumbing and artifact mutation hardening can proceed independently. Rejection APIs unlock compact current-state views. The artifact-contract parser unlocks completion enforcement; parser plus clarify/scaffold work unlock prompt rendering. Final spec/docs updates are blocked until behavior has settled in code.

No HITL tasks are required: the product decisions are captured in the specs and prior discussion. If an agent finds a contradiction between task scope and `specs/artifact-contracts.md`, treat the spec as the source of intent and append a Developer Note before narrowing implementation; do not invent new product policy.

## Supervisor repo-root trunk guard amendment

### Problem statement / MVP goal

Implemented the supervisor-owned repo launch guard from `specs/control-plane-supervision.md`: `pdx init` / `pdx open` scaffold a user-owned `<user-data-dir>/supervisor.toml` once, pdx parses `launch_preconditions.enforce_repo_root_trunk`, and when enabled pdx prevents repo-scoped Agent launches from a repository root that is not on its remote default branch. The scaffold and missing-file runtime default both enable the guard with `enforce_repo_root_trunk = true`; users can disable it by editing the scaffolded file. The Git default-branch probe is local-only: missing `origin/HEAD` metadata is an unknown-default launch precondition, not a reason to contact the network. The failure uses the existing launch-precondition Repair Alert path so Pandora can resolve with the user and replay/supersede as appropriate.

### Important references

- `specs/control-plane-supervision.md` — implemented supervisor launch config and repo default-branch guard contract.
- `specs/README.md` — spec status index, now marking control-plane supervision as implemented.
- `packages/pdx/README.md` — pdx supervisor, init/open materialization, launch precondition, and service-boundary guidance.
- `packages/pithos/README.md` — existing launch-precondition Repair Alert transition and repair semantics.
- `resources/README.md` — resource ownership and scaffold/re-seed lifecycle.
- `resources/user-data-dir/PANDORA.md` — installed user config reference that must document `supervisor.toml` after implementation.
- `packages/spawner/README.md` — boundary reference showing enforcement should not live in Spawner/prompt rendering.

### Task strategy

Tasks 11-14 are added as a follow-up plan after the completed Artifact Contract tasks. The slices first establish the user-owned supervisor config surface, then add the Git repo-state probe behind pdx service boundaries, then wire the configured guard into the existing launch-precondition Repair Alert path, and finally update docs/specs from planned to implemented. No HITL task is required because the architectural decision has already been captured: this belongs in pdx supervisor policy, not `agents.toml`, Spawner, or Agent prompt shell snippets.

## Developer Notes

Append notes here. Do not rewrite earlier notes.

- Task 1: Implemented `clarify` plumbing from artifact specs. The current implemented `specs/control-plane-supervision.md` records the pre-delta capability table for this work stream; consolidated deltas were finalized in Task 9.
- Task 2: Added the Pithos Artifact Contract parser at `packages/pithos/src/artifact-contracts.ts`, exported it from `@pdx/pithos`, and covered disabled/missing/invalid/normalized cases. The loader treats an unset `PDX_USER_DATA_DIR` as disabled and a set-but-non-directory value as a loud `USER_ERROR`.
- Task 3: Hardened `task artifact add` as a fenced held-task mutation requiring `--token`; it now rejects queued/terminal tasks, stale tokens, non-owner runs, and non-lower-snake-case kinds while preserving omitted-stdin empty bodies and returning compact metadata.
- Task 4: Added active/rejected artifact persistence, one-way fenced rejection, exact-id list/show APIs, and compact mutation metadata. Primary task/graph inspect still intentionally show active artifacts only; future inspect compaction remains Task 5.
- Task 5: Compacted task/graph inspect primary views to active artifact refs, added `task inspect --full` for inline active bodies, rejected `--full --json`, removed empty graph artifact blocks, and verified pithos/spawner tests plus full `pnpm verify`.
- Task 6: Completion now loads `$PDX_USER_DATA_DIR/artifacts.toml` through the shared parser and gates only required active artifact kinds; graph JSON/readable output reports missing required artifacts for claimed/running tasks only. Deep review feedback narrowed graph JSON `missing_required` to compact kind strings and prompted README/config-boundary coverage. Validation passed with `pnpm --filter @pdx/pithos test` and full `pnpm verify` (first full verify exposed a transient pdx CLI test failure that passed on focused rerun and on the second full verify).
- Task 7: Added the user-owned `artifacts.toml` scaffold with commented-only examples, wired pdx template materialization to create it only when missing, and documented ownership/enforcement semantics in the installed config reference. The existing launch environment path already passes `PDX_USER_DATA_DIR` through pdx/Spawner.
- Task 8: Rendered applicable Artifact Contract rules next to generated command cards through the public Pithos parser/normalizer. Existing pdx spawn/open coverage exercises the same `renderAgent` boundary that now fails on invalid present `artifacts.toml`; focused `pnpm --filter @pdx/pdx test` passed.
- Task 9: Merged artifact-contract deltas into living implemented specs, centralized detailed Artifact Contract semantics in `specs/artifact-contracts.md`, cross-linked related specs, removed active delta files, updated this plan’s reference list away from retired deltas, and verified with `pnpm verify`.
- Task 10: Updated package/resource docs for the implemented Artifact Contract parser boundary, fenced add/reject APIs, compact/full inspect behavior, user `artifacts.toml` ownership, prompt rendering, and pdx launch/scaffold environment. Verified with `pnpm verify`.
- Task 11: Added scaffold-once `<user-data-dir>/supervisor.toml`, typed pdx supervisor launch-policy parsing, daemon startup validation for invalid present config, and missing-file default behavior matching the scaffold. Verified with `pnpm verify`.
- Task 12: Added `RepoLaunchChecks` as a pdx service boundary with a local-only Git probe for repo root, current branch, `origin/HEAD` default branch metadata, detached HEAD, non-Git paths, and unknown default branch. Focused pdx tests and full `pnpm verify` passed.
- Task 13: Wired parsed supervisor launch policy into daemon reconcile, applied the repo-root trunk guard before render/run creation for repo scopes only, and routed all negative probe outcomes through launch-precondition Repair Alerts with branch evidence and Task Replay guidance. Focused pdx reconcile/spawn coverage passed before full verification. Full user-facing installed docs/spec status updates remain in Task 14; this slice only updated the touched pdx package README.
- Task 14: Updated control-plane and user-facing docs for implemented `supervisor.toml` ownership, scaffold-once behavior, repo Scope default-branch guard semantics, disable instructions, and `launch_precondition` Repair Alert recovery. Marked the control-plane spec implemented and verified with `pnpm verify`.
- Task 15: Added private `@pdx/fagent` bin-only workspace package with Spawner-shaped argv parsing, JSON exact-response config, deterministic builtin `READ` filesystem command, package tests for response/read/loud failure, and package README. Deep review follow-up tightened argv value validation, moved runtime reads behind a small service boundary, used a tagged `FagentError`, removed the library export, and added CLI stderr/exit coverage. Verified focused `pnpm --filter @pdx/fagent test` / `build` and full `pnpm verify`.
- Task 16: Wired `fagent` into Spawner manifest validation, argv rendering, AFK launch, HITL tmux launch, and transcript classification. `fagent` requires an explicit executable path as the first `harness.argv` token so tests can use repo-local builds without PATH installation. HITL starts the fake script under tmux and stays alive with `tail -f /dev/null` only after successful script exit; failed fake scripts still terminate loudly. Pithos/pdx harness-kind types now admit `fagent` so rendered runs can be persisted. Deep review follow-up aligned docs/tests to the real `packages/fagent/bin/fagent` build artifact, rejected bare `fagent` PATH launches, covered AFK launch argument/env forwarding, and updated Pithos CLI/error surfaces. Verified focused `pnpm --filter @pdx/spawner test`, focused `pnpm --filter @pdx/pithos test`, and full `pnpm verify`.
- Task 17: Extended `@pdx/fagent` with JSON-keyed scripted Pithos actions, Spawner env-based run/scope selection, append-only JSONL evidence events, and Pandora-style HITL residency after scripted startup. Added real isolated SQLite workflow coverage for triage -> execute first failure -> Repair Alert replay -> execute completion, plus HITL residency coverage. Verified with full `pnpm verify`.
- Task 18: Added a Podman-only integration container path for tmux smoke testing. The root `pnpm run test:integration:tmux` script builds `containers/Containerfile.integration`, mounts the current repo at `/workspace`, sets container-local `PDX_DATA_DIR`, `PDX_USER_DATA_DIR`, `PITHOS_DB`, and `TMUX_TMPDIR`, then creates/lists/kills a tmux session through an explicit socket under the isolated tmux directory. Verified with `pnpm verify` and `pnpm run test:integration:tmux`. Follow-up YAGNI pass removed the extra smoke helper script and trimmed container packages to the minimum used by this slice plus the workspace build/test stack.
- Task 19: Added `pnpm run test:integration:pdx-open-fagent`, a Podman-backed end-to-end flow that copies the repo into the container, installs/builds repo-local bins, configures Pandora/Toil/War for fagent, seeds triage work, opens pdx, drives Toil -> War failure -> Pandora replay -> War completion, asserts fagent events/task states/tmux cleanup, preserves the host artifact dir on failure, and is now included in root `pnpm verify` after the workspace build. Verified with full `pnpm verify` plus focused fagent/integration reruns.
- Task 20: Documented the validation tiers and fake-Harness integration workflow across root/package docs and specs. The key failure-forensics paths are the preserved Podman artifact dir's `data/pdx.jsonl`, `data/fagent-events.jsonl`, `data/runs/*.stdout.log`, `data/runs/*.stderr.log`, `data/graph-final.json` when present, and `user-config/agents.toml` with repo-local `fagent` argv.

### Task 11-14: Supervisor repo-root trunk guard plan — 2026-06-18

- Added follow-up tasks for the pdx-owned `supervisor.toml` launch policy and repo default-branch guard. These tasks deliberately reuse launch-precondition Repair Alerts and keep enforcement out of Agent prompt policy packs.

### Task 15-20: fagent and Podman tmux integration plan — 2026-06-21

- Added follow-up tasks for a test-only fake Harness package (`@pdx/fagent`) and Podman-backed tmux integration tests. The MVP goal is a real `pdx open` -> Pandora tmux session -> triage -> execute failure -> Repair Alert -> Pandora repair/replay -> execute completion -> `pdx close` flow. Podman is the supported container runtime for this integration path; do not add Docker-specific scripts unless a future HITL decision changes that boundary.
