# Task 26: Verify policy configuration integration

## Scope

Type: AFK

Run focused and full validation for the policy-pack configuration model, including isolated preview smokes that prove bundled prompts are fixed and user policy packs are selected by central rules.

## Must implement exactly

- Run Spawner tests covering prompt foundation locking, policy registry, rule matching, Harness config, hooks, and preview provenance.
- Run pdx tests covering init/open resource materialization and user config preservation.
- Run the repository verification suite.
- Perform an isolated manual smoke with temporary `PDX_DATA_DIR`, `PDX_USER_DATA_DIR`, `PITHOS_DB`, and `TMUX_TMPDIR` that:
  - initializes the data dir
  - creates at least two policy packs in the temp user data dir
  - selects one policy globally and one through a path/glob rule
  - runs `pandora-spawn preview` for at least War and Toil
  - confirms the rendered prompts contain bundled base content and selected policies
  - confirms a same-path user template file does not shadow a bundled prompt
- Record the exact validation commands and any smoke outline in `tasks/README.md` Developer Notes.

## Done when

- Focused validation passes.
- Full `pnpm verify` passes.
- Isolated preview smoke passes without touching real `~/.pdx` or real user config.
- `tasks/README.md` has an appended Task 26 Developer Note with validation evidence.

## Out of scope

- Implementing repairs beyond minimal fixes needed to satisfy the specified behavior.
- Adding migration or compatibility behavior.
- Changing the policy model from the spec.

## References

- `AGENTS.md` smoke-test environment guidance
- `specs/agent-configuration.md`
- `packages/spawner/src/spawner.test.ts`
- `packages/pdx/test/substrate.test.ts`
- `resources/user-data-dir/PANDORA.md`
