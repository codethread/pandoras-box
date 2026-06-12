# Plan: decompose `packages/pithos/src/engine.ts`

## Problem

`src/engine.ts` is ~1550 lines and owns too many unrelated concerns at once:
scope CRUD, run lifecycle transitions, task authoring (enqueue/supersede/replay),
graph-integrity assertions, read-model views (taskInspect/briefing), shared
validation helpers, and the public re-export hub for the package.

A previous extraction round (claim-loop, repair-alerts, task-read-model, …)
left a structural smell behind: the shared helpers (`requireNonEmpty`,
`resolveRunId`, `liveRun`, `authorized`, `scopeForCapability`,
`enforceCapScope`) stayed in `engine.ts`, so the extracted modules receive them
back through `ClaimLoopDeps` / `RepairAlertDeps` parameter bags. These are not
injected services (no test/live variants exist or are wanted) — they are plain
shared functions threaded through an artificial DI layer purely to dodge a
module cycle. That plumbing is the main readability cost of the current shape.

## Intent

Split `engine.ts` by domain concern, following the already-established
`src/engine/*` module pattern, and delete the deps-bag plumbing by giving the
shared helpers a real home that `claim-loop.ts` and `repair-alerts.ts` can
import directly.

Target shape:

- `engine/validation.ts` — input-shaping helpers: `requireNonEmpty`,
  `resolveRunId`, `resolveBody`, `parseHarnessKind`.
- `engine/run-read-model.ts` — run row reading + actor authorization:
  `runSelect`, `toRunOutput`, `runById`, `liveRun`, `authorized`, the
  terminal/active status constants, `runTerminalStatusForTask`,
  `nonEmptyRunCwd`.
- `engine/scopes.ts` — scope read/policy helpers (`scopeById`,
  `enforceActiveScope`, `scopeForCapability`, `enforceTaskAdmissionScope`,
  `enforceCapScope`) plus `makeScopeOps` (scopeUpsert, scopeList,
  scopeArchive) and their SQL.
- `engine/run-lifecycle.ts` — `makeRunLifecycleOps` (runUpsert, runInspect,
  activeRunForTask, runCleanup, runInterrupt, runTimeout, runLaunchAbort) and
  the dead-letter repair-alert body rendering.
- `engine/graph-integrity.ts` — `assertGraphIntegrity` and its private
  cycle/closure checks.
- `engine/task-authoring.ts` — `makeTaskAuthoringOps` (enqueue, supersede,
  replay): the task-graph write transactions.
- `engine/task-views.ts` — `makeTaskViewOps` (taskInspect, briefing,
  artifactList, artifactShow, graphInspect): read-only projections.
- `engine.ts` — thin composition root: `makeEngine` spreads the op groups,
  keeps `init`, and keeps the existing public re-export surface byte-for-byte
  (`parseGraphSinceCutoff`, render fns, `PDX_SYSTEM_RUN_ID`, types,
  `authorized`, `event`, `enforceCapScope`, `taskGateLateGrowthMarkers`).

`ClaimLoopDeps` and `RepairAlertDeps` are removed; `claim-loop.ts` and
`repair-alerts.ts` import the helpers from their new modules. Import graph
stays acyclic: validation → (nothing engine-local), run-read-model →
validation, scopes → validation, lifecycle/authoring/views → the above +
existing modules.

This is grouping by cohesive responsibility, not function-by-function
extraction: each new module is a unit someone would open on its own ("how does
run cleanup work", "what makes a graph valid"), and each `make*Ops` factory
mirrors the existing `makeClaimLoopOps` convention so `makeEngine` reads as a
table of contents.

## Hypothesis

- The behavior surface (`Engine` interface, CLI output, events, error
  codes/messages) is unchanged, so the existing test suite —
  `foundation.test.ts`, `task-lifecycle.test.ts`, `cli.test.ts`,
  `render.test.ts` — passes without modification. Tests already target the
  public boundary (`makeEngine` + `src/engine.js` re-exports), so they should
  survive the refactor untouched; if any test breaks, that is a signal of
  internal coupling and the fix belongs in the test, not in bending the
  module split (per the brief: improve tests rather than refactor around
  them). Current reading of the tests suggests this won't be needed —
  the only internal-ish imports are `parseGraphSinceCutoff` and
  `taskGateLateGrowthMarkers`, both deliberate public re-exports that will be
  preserved.
- `engine.ts` shrinks from ~1550 lines to a <150-line composition/export hub,
  and no new module exceeds ~450 lines.
- Removing the deps bags makes `claim-loop.ts`/`repair-alerts.ts` shorter and
  removes one level of indirection when tracing any transition.

## Verification

`pnpm verify` (lint + typecheck + test + build) green; no snapshot changes
expected. Update `packages/pithos/README.md` module map for the new
`src/engine/*` files in the same change.
