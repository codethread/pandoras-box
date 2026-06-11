# Task 10: Update artifact package docs

## Scope

Type: AFK

Update package and resource documentation to match the implemented Artifact Contracts behavior after the specs have been merged.

## Must implement exactly

- Update `packages/pithos/README.md` for:
  - Artifact Contract parser/export boundary
  - fenced artifact add/reject ownership
  - artifact list/show/reject APIs
  - compact/default vs `--full` task inspect behavior
  - active/rejected artifact visibility rules
- Update `packages/spawner/README.md` for:
  - generated Artifact Contract prompt section
  - shared Pithos parser usage
  - preview failure behavior for invalid present `artifacts.toml`
- Update `packages/pdx/README.md` for:
  - scaffold-once `$PDX_USER_DATA_DIR/artifacts.toml`
  - preservation across init/open/clean/nuke
  - pdx-launched Agent environment expectations
- Update `resources/README.md` and `resources/user-data-dir/PANDORA.md` for user-facing Artifact Contract configuration guidance.
- Ensure command descriptions/help examples in docs match actual CLI behavior.

## Done when

- Package/resource docs agree with implemented CLI/config behavior and merged specs.
- No doc claims artifact rules live in `agents.toml`.
- No doc claims artifact bodies are required for required-artifact satisfaction.
- `pnpm verify` passes or failures are unrelated to docs and are documented in `tasks/README.md` Developer Notes.

## Out of scope

- Editing spec files except for broken links discovered while updating docs.
- Implementing missing behavior.
- Adding non-MVP user workflow recommendations beyond the shipped scaffold/reference.

## References

- `specs/artifact-contracts.md`.
- `packages/pithos/README.md`.
- `packages/spawner/README.md`.
- `packages/pdx/README.md`.
- `resources/README.md`.
- `resources/user-data-dir/PANDORA.md`.
