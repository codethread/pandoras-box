# Task 20: Document integration test workflow

## Scope

Type: AFK

Document the completed fake-Harness and Podman-backed tmux integration workflow so future agents can run the right validation tier and debug failures without rediscovering the setup.

## Must implement exactly

- Update package and root documentation to describe:
  - what `fagent` is and that it is test-only;
  - how user config selects `fagent` for integration tests using repo-local paths;
  - how to run fast unit tests versus Podman integration tests;
  - how `pnpm verify` orders and includes both tiers;
  - where integration logs/data dirs are written and how to inspect them after failure.
- Keep domain/spec docs aligned with the implemented contract, especially the Harness and control-plane boundaries.
- Avoid presenting `fagent` as a supported user Harness for normal production use.

## Done when

- Relevant READMEs are in sync with the implemented commands and package boundaries.
- `pnpm verify` passes after documentation changes.
- A future agent can identify the fast validation command and the full Podman integration command from docs alone.

## Out of scope

- New behavior or test cases.
- Reworking existing user-facing Pandora's Box introduction beyond necessary validation/documentation updates.

## References

- `README.md`
- `specs/harness-contract.md`
- `specs/control-plane-supervision.md`
- `packages/fagent/README.md`
- `packages/pdx/README.md`
- `packages/spawner/README.md`
