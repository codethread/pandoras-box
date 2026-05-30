# Task 21: Lock bundled prompt foundation

## Scope

Type: AFK

Replace the render-time prompt composition model so bundled Agent templates and bundled shared prompt fragments are always loaded from the canonical bundled resources. User config must no longer be able to replace `agents/*.md`, `common/*.md`, or generated command cards by same-path files, `template`, `includes`, or `appends` manifest fields. Spawner manifest resolution must read only bundled defaults plus `$PDX_USER_DATA_DIR/agents.toml`; it must not discover user scope directories or project-local `.pdx` manifests.

## Must implement exactly

- Remove user scope-directory and project-local `.pdx` manifest discovery from Spawner render resolution; render config reads bundled defaults and `$PDX_USER_DATA_DIR/agents.toml` only.
- Keep the bundled `resources/data-dir/agents.toml` as the source of built-in Agent harness defaults and the bundled prompt references used by the product.
- Reject user `agents.toml` fields that attempt prompt replacement/composition: `agents.<kind>.template`, `agents.<kind>.includes`, and `agents.<kind>.appends` outside the bundled manifest.
- Preserve existing Harness customization support for agent kind, model, system prompt mode, tools, and argv.
- Preserve existing hook loading behavior only until Task 24 centralizes the hook contract; do not add new hook features in this slice.
- Update preview/render provenance so it no longer reports user-selected template/appends layers as customization surfaces; it should show the bundled prompt assets used.
- Add regression coverage proving a user file at `<user-data-dir>/templates/agents/war.md` or `<user-data-dir>/templates/common/base.md` does not affect rendered War prompts.

## Done when

- `pandora-spawn preview` still renders every bundled Agent with the bundled base prompt and generated command cards.
- A same-path user template file cannot shadow a bundled Agent or common prompt.
- User manifest attempts to set `template`, `includes`, or `appends` fail with a tagged validation error.
- User scope-directory and project-local `.pdx` manifests do not affect Harness config, prompt content, or preview provenance.
- Existing Harness override tests still pass or are updated to the new contract.
- Focused Spawner tests pass: `pnpm --filter @pdx/spawner test -- spawner.test.ts`.

## Out of scope

- Adding policy packs.
- Adding path/glob match rules.
- Rewriting bundled prompt content.
- Implementing migration or compatibility for old template/appends config.

## References

- `specs/agent-configuration.md`
- `packages/spawner/src/manifest.ts`
- `packages/spawner/src/spawner.ts`
- `packages/spawner/src/paths.ts`
- `resources/data-dir/agents.toml`
- `resources/data-dir/templates/`
