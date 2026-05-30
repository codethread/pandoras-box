# Task 24: Centralize hook configuration

## Scope

Type: AFK

Update input hook configuration to match the centralized user manifest model. Hooks are user-wide supervisor config loaded from bundled defaults plus `<user-data-dir>/agents.toml`; rules, scope directories, and project-local `.pdx` files must not affect hook supervision.

## Must implement exactly

- Remove legacy hook loading from `<user-data-dir>/scopes/global`, repo/worktree scope directories, and project-local `.pdx` manifests.
- Keep bundled hook defaults, if any, as the lowest-priority source and `<user-data-dir>/agents.toml` as the only user override source.
- Preserve hook field behavior from the spec: optional `enabled`, optional non-empty argv `command`, command implies enabled when `enabled` is unset, and `enabled = false` disables a configured hook.
- Preserve fail-loud validation for `enabled = false` with `command` in the same table.
- Ensure `[[rules]]` cannot configure hooks; unknown `hooks` under rules fails validation.
- Update pdx hook supervision tests and Spawner hook loading tests to prove path/scope/project config cannot affect hooks.

## Done when

- A hook in `<user-data-dir>/agents.toml` is loaded and supervised as before.
- Hook config in any old scope/project location is ignored or rejected according to the new parser boundary, and tests cover the chosen fail-loud behavior for parsed unsupported locations.
- Rule tables cannot define hooks.
- Focused tests pass: `pnpm --filter @pdx/pdx test -- substrate.test.ts` and `pnpm --filter @pdx/spawner test -- spawner.test.ts`.

## Out of scope

- Changing input hook NDJSON payload semantics.
- Changing hook restart/backoff behavior.
- Adding migration or compatibility behavior for old hook locations.

## References

- `specs/agent-configuration.md`
- `specs/control-plane-supervision.md`
- `packages/spawner/src/manifest.ts`
- `packages/pdx/src/controller.ts`
- `packages/pdx/test/substrate.test.ts`
