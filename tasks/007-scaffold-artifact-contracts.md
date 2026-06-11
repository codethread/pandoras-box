# Task 7: Scaffold artifact contracts

## Scope

Type: AFK

Add the user-owned `artifacts.toml` scaffold to pdx init/open and document it in the installed user configuration reference. The scaffold must contain commented examples only and must never overwrite user edits.

## Must implement exactly

- Add `resources/user-data-dir/artifacts.toml` with commented recommended examples focused on clarify and generic artifact guidance. Any design/execute examples must be clearly non-normative and must not imply the deferred signed-brief invariant.
- Ensure `pdx init` and `pdx open` copy/scaffold `$PDX_USER_DATA_DIR/artifacts.toml` only when missing.
- Do not overwrite existing user `artifacts.toml` in normal init/open, clean, or nuke flows.
- Update `resources/user-data-dir/PANDORA.md` to explain:
  - `artifacts.toml` is user-owned
  - active entries are parsed by Pithos when `PDX_USER_DATA_DIR` is set
  - `required = true` gates task completion by active artifact kind presence
  - `title` and `body` are prompt guidance only
- Ensure pdx-launched agents continue to receive `PDX_USER_DATA_DIR` in their environment.

## Done when

- A fresh isolated `pdx init` creates `artifacts.toml` in the user data dir.
- Re-running `pdx init` or `pdx open` preserves a modified `artifacts.toml`.
- Clean/nuke behavior preserves user-owned `artifacts.toml` consistently with other user config files.
- Tests cover scaffold-once behavior.
- `pnpm --filter @pdx/pdx test` passes.

## Out of scope

- Pithos parsing or enforcing Artifact Contracts.
- Spawner prompt rendering.
- Enabling any active bundled artifact requirements.

## References

- `specs/artifact-contracts.md` sections 2 and 3.
- `specs/control-plane-supervision.md`.
- `packages/pdx/src/live.ts`.
- `resources/user-data-dir/PANDORA.md`.
- `resources/README.md`.
