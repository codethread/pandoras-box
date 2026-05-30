# Task 25: Update policy scaffolds and docs

## Scope

Type: AFK

Align bundled seed resources, installed user reference docs, package docs, and tests with the implemented policy-pack configuration model.

## Must implement exactly

- Update `resources/user-data-dir/agents.toml` comments to show policy declarations, `policy.add`, Agent policy selection, match rules, Harness settings, and hook configuration.
- Ensure `resources/user-data-dir/PANDORA.md` matches the implemented config fields and preview provenance from Tasks 21–24.
- Keep `resources/README.md` as a resource ownership map that points to the spec and `PANDORA.md`, without duplicating the full config contract.
- Update package READMEs that describe Spawner/pdx config behavior so they no longer mention template/appends/scopes/project `.pdx` layering as the current model.
- Update tests that assert seeded reference content or scaffold text.
- Remove stale references to `templates/war/cwd-guard.md`, user template shadowing, `appends`, `includes`, config `replace`, scope directories, and project `.pdx` config from user-facing docs.

## Done when

- Fresh `pdx init` materializes user config reference files consistent with policy packs.
- Docs point users toward `<user-data-dir>/agents.toml` plus `policies/` files for customization.
- `rg` over docs/resources does not show the old template/appends/layering model as active guidance.
- Focused pdx and Spawner tests pass: `pnpm --filter @pdx/pdx test -- substrate.test.ts` and `pnpm --filter @pdx/spawner test -- spawner.test.ts`.

## Out of scope

- Changing the canonical specs beyond small corrections for implementation discoveries.
- Adding compatibility notes or migration instructions.
- Implementing code behavior not already covered by Tasks 21–24.

## References

- `specs/agent-configuration.md`
- `resources/README.md`
- `resources/user-data-dir/PANDORA.md`
- `resources/user-data-dir/agents.toml`
- `packages/spawner/README.md`
- `packages/pdx/README.md`
