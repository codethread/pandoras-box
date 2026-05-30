# Task 23: Add policy match rules

## Scope

Type: AFK

Add ordered `[[rules]]` support to the user policy registry so one central `<user-data-dir>/agents.toml` can select project-specific or launch-specific policies by path, path glob, scope kind, and Agent kind.

## Must implement exactly

- Parse and validate `[[rules]]` entries with supported predicates: `path`, `path_glob`, `scope_kind`, and `agent`.
- A rule applies only when every predicate present in the rule matches the launch context.
- Apply matching rules in file order after top-level and Agent-level policy selection.
- Support `rules[].policy.add/remove` and `rules[].agents.<kind>.policy.add/remove` with the same uniqueness and absent-remove validation as Task 22.
- Normalize `~` in path and path_glob predicates before matching.
- Match `path` and `path_glob` against one normalized launch path: for repo and worktree launches use the recorded scope path from `scopeId` when present, falling back to `cwd`; for global launches use `cwd`.
- Reject unknown predicates, invalid glob syntax, invalid scope kind values, and invalid Agent kinds with tagged validation errors.
- Extend preview provenance to show matched rules in order and the policy changes they contributed.

## Done when

- A `path_glob = "~/work/**"` rule can add an org policy for matching launches.
- Preview provenance reports the normalized path used for rule matching, and runtime render uses the same value.
- A narrower exact `path = "..."` rule can remove a generic policy and add a project-specific policy.
- A `scope_kind = "worktree"` and `agent = "war"` rule applies only to War worktree launches.
- Non-matching rules do not affect policy selection.
- Preview output identifies which rules matched and which policy files rendered.
- Focused Spawner tests pass: `pnpm --filter @pdx/spawner test -- spawner.test.ts`.

## Out of scope

- Project-local `.pdx` discovery.
- Scope directory config layers.
- Policy profiles or nested policy imports.
- Migration from old `scopes/` directories.

## References

- `specs/agent-configuration.md`
- `packages/spawner/src/manifest.ts`
- `packages/spawner/src/spawner.ts`
- `packages/spawner/src/spawner.test.ts`
