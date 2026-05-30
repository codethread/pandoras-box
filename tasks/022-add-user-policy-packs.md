# Task 22: Add user policy packs

## Scope

Type: AFK

Implement the named policy-pack registry and user-wide policy selection described in `specs/agent-configuration.md`. A user `agents.toml` can declare policy ids, add/remove policies globally or per Agent, and Spawner appends the selected policy Markdown after the bundled prompt and generated command reference.

## Must implement exactly

- Extend user manifest parsing with `policies.<policy-id>.file`, `[policy]`, and `[agents.<kind>.policy]`.
- Validate policy ids as lowercase kebab-case.
- Resolve relative policy files under `$PDX_USER_DATA_DIR`; support absolute paths and `~/...` paths; fail loudly for missing or unreadable policy files.
- Implement `policy.add` and `policy.remove`; do not implement policy `replace`.
- Enforce unique final policy ids: adding an already-selected policy or removing an absent policy fails loudly.
- Append selected policy file contents after the bundled prompt and generated command reference separated by `\n\n---\n\n`.
- Ensure policy Markdown is appended verbatim and is not processed as a template.
- Add preview provenance for selected policy ids and their resolved file paths.
- Keep Harness customization behavior from Task 21 working.

## Done when

- A user-wide policy selected by `[policy].add` appears in rendered prompts for all Agents.
- A policy selected by `[agents.toil.policy].add` appears only in Toil's rendered prompt.
- `remove` can subtract a globally selected policy for one Agent.
- Missing policy definitions, missing policy files, duplicate add, absent remove, invalid ids, and `replace` all fail with tagged validation errors.
- Focused Spawner tests pass: `pnpm --filter @pdx/spawner test -- spawner.test.ts`.

## Out of scope

- Path/glob/scope/agent match rules.
- Project-local `.pdx` config.
- Variable substitution inside policy files.
- Hook behavior changes beyond keeping existing tests green.

## References

- `specs/agent-configuration.md`
- `packages/spawner/src/manifest.ts`
- `packages/spawner/src/spawner.ts`
- `resources/user-data-dir/PANDORA.md`
