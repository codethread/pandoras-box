# Plan: decompose `packages/pithos/src/engine.ts`

## Problem

`src/engine.ts` is a 1551-line god file. Previous extractions (claim-loop, repair-alerts,
task-read-model, graph-inspect, event-log, render) carved off cohesive pieces, but the
remainder still mixes five unrelated concerns inside one `makeEngine` object literal:

1. Scope ops (`scopeUpsert`/`scopeList`/`scopeArchive`) plus scope admission rules
   (`scopeForCapability`, `enforceTaskAdmissionScope`, `enforceCapScope`).
2. Run lifecycle ops (`runUpsert`/`runInspect`/`activeRunForTask`/`runCleanup`/
   `runInterrupt`/`runTimeout`/`runLaunchAbort`) plus the run read model
   (`runSelect`, `liveRun`, `runById`, `toRunOutput`, `authorized`).
3. Task admission ops (`enqueue`/`supersede`/`replay`) plus graph-integrity assertions.
4. Read-only inspection ops (`taskInspect`, `graphInspect`, `briefing`,
   `artifactList`, `artifactShow`).
5. Shared input resolution (`requireNonEmpty`, `resolveRunId`, `resolveBody`,
   `parseHarnessKind`) and the public re-export surface.

## Hypothesis

The file stayed large for a structural reason, not an accidental one: the shared
actor/run/scope helpers are trapped inside `engine.ts`, so the already-extracted
submodules (`claim-loop.ts`, `repair-alerts.ts`) cannot import them directly and instead
receive them through `ClaimLoopDeps` / `RepairAlertDeps` parameter objects. That
injection pattern exists purely because of file layout — these are not swappable
dependencies (nothing ever passes a different implementation) — and it makes every
further extraction look like it would _add_ indirection. Once the shared helpers live in
real modules, the deps objects disappear, the remaining ops split along the same
`make*Ops(ctx)` factory pattern the codebase already uses, and `engine.ts` collapses to a
composition root plus the public re-export boundary.

Readability should improve, not just file size: each module will read top-to-bottom as
one domain (its SQL, its row parsing, its rules, its ops), instead of SQL constants at
line 160 serving an op at line 530.

## Intended end state

```
src/engine.ts                  composition root: makeEngine spreads the ops factories,
                               owns `init`, keeps the existing public re-exports verbatim
src/engine/inputs.ts           requireNonEmpty, resolveRunId, resolveBody, parseHarnessKind
src/engine/scopes.ts           scope SQL + scope row schemas/parsers (moved from
                               task-read-model.ts, which only engine.ts used), scopeById,
                               enforceActiveScope, scopeForCapability,
                               enforceTaskAdmissionScope, enforceCapScope, makeScopeOps
src/engine/run-read-model.ts   runSelect, toRunOutput, runById, liveRun, authorized,
                               terminal/active status sets (mirrors task-read-model.ts;
                               kept separate from run-lifecycle.ts so repair-alerts.ts can
                               import liveRun without an import cycle through
                               createRepairAlertInTxn)
src/engine/run-lifecycle.ts    makeRunLifecycleOps (upsert/inspect/activeRunForTask/
                               cleanup/interrupt/timeout/launch-abort) + dead-letter
                               repair-alert body rendering
src/engine/task-admission.ts   makeTaskAdmissionOps (enqueue/supersede/replay) +
                               graph-integrity assertions, with the two copy-pasted DFS
                               cycle walkers (blocking vs membership) unified into one
                               parameterized check
src/engine/inspect-ops.ts      makeInspectOps (taskInspect/graphInspect/briefing/
                               artifactList/artifactShow)
src/engine/claim-loop.ts       ClaimLoopDeps deleted; direct imports
src/engine/repair-alerts.ts    RepairAlertDeps deleted; direct imports
```

Small readability cleanups along the way (no behavior change):

- The three duplicated `path_missing` computations in scope ops become one helper.
- The duplicated acyclicity DFS becomes one function taking the edge filter and the
  failure message.

## Non-goals / invariants

- Zero public-surface change: `index.ts`, `cli.ts`, and test imports from
  `../src/engine.js` keep working unmodified. `engine.ts` continues to re-export
  `authorized`, `event`, `taskGateLateGrowthMarkers`, `PDX_SYSTEM_RUN_ID`,
  `parseGraphSinceCutoff`, the render helpers, and all output types.
- Zero behavior change: no SQL, transaction boundary, fencing precondition, event
  payload, or error code/message is altered. This is a move-and-dedupe refactor.
- No new tests: existing suites (`foundation`, `task-lifecycle`, `cli`, `render`) already
  exercise every moved op through the public `makeEngine` boundary, which is exactly the
  contract this refactor must preserve.

## Verification

`pnpm verify` (lint + typecheck + test + build) green; then update
`packages/pithos/README.md` "Implemented module design" to describe the new engine
submodule layout.
