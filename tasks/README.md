# Artifact Contracts AFK Plan

## Problem statement / MVP goal

Implement the Artifact Contracts MVP described by `specs/artifact-contracts.md`: user-owned artifact guidance, fenced artifact mutation, active/rejected artifact status, required-artifact completion gates, compact artifact inspection, and prompt-visible normalized contract data. The MVP intentionally enforces artifact presence only; it does not validate artifact body semantics, counts, or signed brief status.

## Important references

- `specs/artifact-contracts.md` — implemented Artifact Contract semantics and centralized config/API contract.
- `specs/task-graph.md` — implemented Task graph artifact lifecycle, completion, and inspection behavior.
- `specs/control-plane-supervision.md` — implemented pdx scaffolding/environment and `clarify` capability behavior.
- `specs/agent-command-reference.md` — implemented command-card and artifact prompt guidance behavior.
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

## Developer Notes

Append notes here. Do not rewrite earlier notes.

- Task 1: Implemented `clarify` plumbing from the artifact-contract deltas. The current implemented `specs/control-plane-supervision.md` still lists the pre-delta capability table; left spec merge to Task 9 per plan.
- Task 2: Added the Pithos Artifact Contract parser at `packages/pithos/src/artifact-contracts.ts`, exported it from `@pdx/pithos`, and covered disabled/missing/invalid/normalized cases. The loader treats an unset `PDX_USER_DATA_DIR` as disabled and a set-but-non-directory value as a loud `USER_ERROR`.
- Task 3: Hardened `task artifact add` as a fenced held-task mutation requiring `--token`; it now rejects queued/terminal tasks, stale tokens, non-owner runs, and non-lower-snake-case kinds while preserving omitted-stdin empty bodies and returning compact metadata.
- Task 4: Added active/rejected artifact persistence, one-way fenced rejection, exact-id list/show APIs, and compact mutation metadata. Primary task/graph inspect still intentionally show active artifacts only; future inspect compaction remains Task 5.
- Task 5: Compacted task/graph inspect primary views to active artifact refs, added `task inspect --full` for inline active bodies, rejected `--full --json`, removed empty graph artifact blocks, and verified pithos/spawner tests plus full `pnpm verify`.
- Task 6: Completion now loads `$PDX_USER_DATA_DIR/artifacts.toml` through the shared parser and gates only required active artifact kinds; graph JSON/readable output reports missing required artifacts for claimed/running tasks only. Deep review feedback narrowed graph JSON `missing_required` to compact kind strings and prompted README/config-boundary coverage. Validation passed with `pnpm --filter @pdx/pithos test` and full `pnpm verify` (first full verify exposed a transient pdx CLI test failure that passed on focused rerun and on the second full verify).
- Task 7: Added the user-owned `artifacts.toml` scaffold with commented-only examples, wired pdx template materialization to create it only when missing, and documented ownership/enforcement semantics in the installed config reference. The existing launch environment path already passes `PDX_USER_DATA_DIR` through pdx/Spawner.
- Task 8: Rendered applicable Artifact Contract rules next to generated command cards through the public Pithos parser/normalizer. Existing pdx spawn/open coverage exercises the same `renderAgent` boundary that now fails on invalid present `artifacts.toml`; focused `pnpm --filter @pdx/pdx test` passed.
- Task 9: Merged artifact-contract deltas into living implemented specs, centralized detailed Artifact Contract semantics in `specs/artifact-contracts.md`, cross-linked related specs, removed active delta files, updated this plan’s reference list away from retired deltas, and verified with `pnpm verify`.
