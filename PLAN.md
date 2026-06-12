# PLAN: decompose `packages/pithos/src/engine.ts`

## Problem

`engine.ts` is ~1550 lines. Prior extractions (`engine/claim-loop.ts`,
`engine/repair-alerts.ts`, `engine/task-read-model.ts`, …) moved cohesive
units out, but the residue is still a god file mixing four unrelated
concerns, plus an awkward seam: the already-extracted modules receive shared
helpers (`liveRun`, `authorized`, `requireNonEmpty`, …) back through
hand-rolled `ClaimLoopDeps` / `RepairAlertDeps` interfaces because those
helpers still live in the god file. That injection is pure indirection — the
helpers are concrete functions over `Db`, not swappable services (real DI
already flows through `ctx.services`).

## Hypothesis

Splitting by domain concern — and moving the shared run/scope helpers into a
real module so the `Deps` interfaces can be deleted — leaves every file
readable on its own, with `engine.ts` reduced to composition + the public
re-export surface. No behavior change; no public API change.

## Intended shape

- `engine/validate.ts` — input parsing shared by ops: `requireNonEmpty`,
  `resolveRunId`, `resolveBody`, `parseHarnessKind`.
- `engine/actors.ts` — run/scope lookup, authorization, and scope policy:
  `runSelect`/`scopeSelect` SQL, `liveRun`, `runById`, `scopeById`,
  `enforceActiveScope`, `authorized`, `scopeForCapability`,
  `enforceTaskAdmissionScope`, `enforceCapScope`.
- `engine/scope-ops.ts` — `scopeUpsert`, `scopeList`, `scopeArchive` and
  their SQL.
- `engine/run-lifecycle.ts` — `toRunOutput`, run upsert SQL,
  `runUpsert`, `runInspect`, `activeRunForTask`, `runCleanup`,
  `runInterrupt`, `runTimeout`, `runLaunchAbort`, dead-letter alert body.
- `engine/task-authoring.ts` — `enqueue`, `replay`, `supersede` and the
  graph-integrity assertions they share.
- `engine/read-ops.ts` — thin read ops: `artifactList`, `artifactShow`,
  `taskInspect`, `briefing`, `graphInspect`.
- `engine.ts` — `makeEngine` composing the op groups (`init` stays inline)
  plus the existing re-exports, unchanged for consumers (`cli.ts`,
  `index.ts`, tests).
- Delete `ClaimLoopDeps` / `RepairAlertDeps`; `claim-loop.ts` and
  `repair-alerts.ts` import the shared helpers directly.

## Test posture

The suite already targets public boundaries (`src/index.js`; two files use
stable `src/engine.js` re-exports). No test is coupled to engine internals,
so tests stay as-is and act as the behavioral safety net. Gate: `pnpm verify`
green.

## Non-goals

- No behavior, SQL, error-code, or event-payload changes.
- No reshuffling of already-extracted engine modules beyond deleting the
  Deps indirection.
