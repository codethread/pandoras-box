# Task 6: Enforce required artifact completion

## Scope

Type: AFK

Wire the Artifact Contract parser into Pithos task completion so configured required artifact kinds must be present as active artifacts before a held task can complete. Add the live graph missing-required signal for claimed/running work.

## Must implement exactly

- During `pithos task complete`, load the current Artifact Contract according to `PDX_USER_DATA_DIR` semantics.
- For the completing task's Capability, require at least one active artifact for each rule with `required = true`.
- Ignore optional rules for completion gating.
- Treat rejected artifacts as absent.
- Treat empty artifact bodies as valid presence.
- Do not validate artifact title/body text or artifact counts.
- Fail with tagged `VALIDATION_ERROR` listing missing required kinds and their guidance titles.
- Add compact graph JSON requirement status for `claimed` and `running` tasks whose Capability has required rules: `{ missing_required: [...] }`, including an empty list when all required artifacts are present.
- Add readable graph missing-required text only for claimed/running tasks with missing required artifacts.
- Do not add task inspect schema/status rendering.

## Done when

- Completion succeeds with no `PDX_USER_DATA_DIR` and no contract.
- Completion succeeds with `PDX_USER_DATA_DIR` set and no `artifacts.toml`.
- Completion fails loudly for malformed present config.
- Completion fails when required active artifact kinds are missing.
- Completion succeeds when required active artifact kinds exist, even with empty bodies.
- Rejected artifacts do not satisfy required kinds.
- Graph requirement status appears only for claimed/running tasks with required rules.
- `pnpm --filter @pdx/pithos test` passes.

## Out of scope

- Prompt rendering of artifact rules.
- Scaffold creation of `artifacts.toml`.
- Retrospective validation of completed tasks.
- Task inspect requirement status.

## References

- `specs/artifact-contracts.md` sections 5 and 8.
- `packages/pithos/src/engine/claim-loop.ts`.
- `packages/pithos/src/engine/graph-inspect.ts`.
- `packages/pithos/src/engine/render.ts`.
- `packages/pithos/test/task-lifecycle.test.ts`.
- `packages/pithos/test/cli.test.ts`.
