# Task 11: Scaffold supervisor launch config

## Scope

Type: AFK

Add the pdx-owned user configuration surface for supervisor launch policy. The new scaffold is `<user-data-dir>/supervisor.toml`, created by the same init/open materialization path as the other user-owned config files and never overwritten after creation.

## Must implement exactly

- Add a scaffolded `supervisor.toml` resource under the user-data-dir resources with this active setting:

  ```toml
  [launch_preconditions]
  enforce_repo_root_trunk = true
  ```

- Wire pdx init/open materialization so missing user config creates `supervisor.toml` once, while preserving existing `supervisor.toml` contents on later init/open runs.
- Add typed parsing for pdx supervisor launch policy with a boolean `launch_preconditions.enforce_repo_root_trunk` field.
- Keep the parser fail-loud for invalid TOML, unknown fields, or wrong field types.
- Define the missing-file behavior explicitly in code and tests: if `supervisor.toml` is absent outside the normal materialization path, pdx must not crash and must behave as though `launch_preconditions.enforce_repo_root_trunk = true`, matching the scaffolded file.
- Add focused tests proving scaffold-once preservation, the missing-file default, and parse behavior.

## Done when

- `pdx init` / template materialization creates `<user-data-dir>/supervisor.toml` when missing.
- Re-running materialization preserves a user-edited `supervisor.toml` while still re-seeding `PANDORA.md`.
- Invalid present `supervisor.toml` fails with a tagged pdx/config error before launching Agents.
- A missing `supervisor.toml` outside normal materialization parses as `enforce_repo_root_trunk = true`.
- Focused pdx tests for init/materialization/config parsing pass.

## Out of scope

- Do not enforce the repo branch guard yet.
- Do not add Git subprocess probing yet.
- Do not move existing Spawner `agents.toml` policy or Harness configuration.
- Do not change Artifact Contract behavior.

## References

- `specs/control-plane-supervision.md` — planned supervisor launch config and repo guard contract.
- `resources/README.md` — resource ownership and scaffold/re-seed lifecycle.
- `resources/user-data-dir/PANDORA.md` — installed user config reference to update later.
- `packages/pdx` — pdx supervisor/config/materialization boundary.
