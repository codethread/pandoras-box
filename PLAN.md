# Pithos Engine Refactor Plan

## Intent

Refactor `packages/pithos/src/engine.ts` from a god-file into cohesive Engine modules while preserving the public `makeEngine` API and all existing CLI/library behavior.

The refactor should improve navigation by moving whole responsibility clusters, not by scattering tiny helpers into isolated files.

## Hypothesis

`engine.ts` is large because it currently mixes four different responsibilities:

1. Engine assembly and public re-exports.
2. Shared IO-boundary helpers and row guards for Runs/Scopes.
3. Scope and Run lifecycle transition orchestration.
4. Task graph mutation orchestration for enqueue/replay/supersede plus graph integrity checks.

If those clusters become modules under `packages/pithos/src/engine/`, then `engine.ts` can become the composition root: initialize DB, spread cohesive operation groups, and keep the public package boundary stable.

## Planned seams

1. **Shared guards/read helpers**
   - Create an Engine support module for input normalization and DB row guards: non-empty validation, `--run` resolution, body resolution, harness-kind parsing, run/scope lookups, run output mapping, authorization, capability/scope admission.
   - This makes extracted operation modules read from the same vocabulary instead of passing a large helper bag through `engine.ts`.

2. **Graph integrity**
   - Move branch-membership, gate-owner, and blocking-cycle assertions into `engine/graph-integrity.ts`.
   - These are pure graph invariant checks used by task mutations.

3. **Scope operations**
   - Move `scopeUpsert`, `scopeList`, and `scopeArchive` into a scope operation module.
   - Keep path-admission and archive guards close to scope behavior.

4. **Run lifecycle operations**
   - Move `runUpsert`, `runInspect`, `activeRunForTask`, `runCleanup`, `runInterrupt`, `runTimeout`, and `runLaunchAbort` into a run lifecycle module.
   - Keep dead-letter repair-alert body construction with Cleanup because it is part of that lifecycle decision.

5. **Task definition mutations**
   - Move `enqueue`, `replay`, and `supersede` into a task mutation module.
   - These operations all create or rewrite Task definitions and share authorization, chain policy, late-growth, graph-integrity, and event concerns.

6. **Read/inspection surfaces**
   - Move artifact list/show, task inspect, graph inspect delegation, and briefing into an inspection module.
   - These are read-only Engine surfaces and should not be mixed with transition orchestration.

7. **Engine composition root**
   - Leave `engine.ts` as the package-facing composition root: exports, DB init, event/prune delegates, operation module assembly, and compatibility re-exports.
   - Do not change `Engine` types or consumer imports.

## Validation plan

- Run `pnpm --filter @pdx/pithos typecheck`.
- Run `pnpm --filter @pdx/pithos test`.
- If pithos-local checks pass, run `pnpm verify` if time and scope allow.

## Non-goals

- No behavior changes to task graph semantics, Run lifecycle, Artifact Contracts, or CLI output.
- No schema changes.
- No public API changes beyond preserving existing exports.
- No broad test rewrites unless the refactor exposes a real regression.
