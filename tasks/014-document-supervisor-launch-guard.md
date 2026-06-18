# Task 14: Document supervisor launch guard

## Scope

Type: AFK

Update the durable and user-facing documentation after the supervisor config and repo trunk launch guard are implemented. The docs must make the new `supervisor.toml` ownership and failure semantics clear without resurrecting prompt-script policy guidance.

## Must implement exactly

- Update the control-plane spec from planned/partial language to implemented language for supervisor launch config and repo default-branch enforcement.
- Update the spec index status if the control-plane spec returns to fully implemented.
- Update resource/user config documentation so users know:
  - `supervisor.toml` is user-owned,
  - `pdx init` / `pdx open` scaffold it once and do not overwrite edits,
  - `PANDORA.md` remains re-seeded reference material,
  - `enforce_repo_root_trunk = true` applies to repo Scopes only,
  - guard failures become `launch_precondition` Repair Alerts for Pandora to resolve/replay.
- Update the root README plus pdx package/resource READMEs wherever they list user config files, init/open scaffold behavior, or launch precondition behavior.
- Remove or explicitly supersede any guidance that suggests this guard should be run as an Agent prompt policy or shell snippet.

## Done when

- The implemented docs consistently list `<user-data-dir>/supervisor.toml` alongside other user-owned scaffold-once config files.
- The control-plane spec status and wording match the shipped behavior.
- User-facing docs explain how to disable or edit the guard through `supervisor.toml`.
- Documentation validation or the project's standard docs-adjacent checks pass.

## Out of scope

- Do not change code behavior in this documentation task except for correcting doc-generated fixtures if required by tests.
- Do not add new supervisor policy fields beyond `launch_preconditions.enforce_repo_root_trunk`.
- Do not create a project-local `.pdx` configuration layer.

## References

- `specs/control-plane-supervision.md` — spec to transition after implementation.
- `specs/README.md` — spec index status.
- `resources/README.md` — resource ownership map.
- `resources/user-data-dir/PANDORA.md` — installed user config reference.
- `README.md` — top-level user onboarding and typical config file list.
- `packages/pdx/README.md` — pdx lifecycle and config documentation.
