# Task 8: Render artifact contracts in prompts

## Scope

Type: AFK

Render normalized Artifact Contract guidance into Agent prompts using the shared Pithos parser, without adding artifact rules to `agents.toml` or introducing a user-editable template variable.

## Must implement exactly

- Import the public Pithos Artifact Contract parser/normalizer from `@pdx/pithos` in Spawner.
- During render/preview, load `$PDX_USER_DATA_DIR/artifacts.toml` with the same parser semantics as Pithos.
- If selected/current Capability is known, include only rules for that Capability.
- Otherwise include rules for all Capabilities the rendered Agent can claim.
- Include required and optional rules with `required` explicitly defaulted.
- Render a generated Artifact Contract section adjacent to generated command cards.
- The section contains a short preamble and minified normalized JSON.
- Omit the section when no rules apply.
- Present-but-invalid `artifacts.toml` fails preview/render loudly.
- Do not add `{{artifact_contract}}` or any other new user template variable.

## Done when

- `pandora-spawn preview` prompt includes minified Artifact Contract JSON for applicable rules.
- Preview omits the Artifact Contract section when no rules apply.
- Preview fails loudly for invalid present `artifacts.toml`.
- Capability filtering is covered for selected capability, single-claim/no-selected-capability, and multi-claim/no-selected-capability cases; include Envy with `clarify` after Task 1.
- Invalid present `artifacts.toml` fails `pandora-spawn preview` loudly.
- Invalid present `artifacts.toml` also fails the pdx render/open path loudly through the same Spawner render boundary.
- `pnpm --filter @pdx/spawner test` passes.
- `pnpm --filter @pdx/pdx test` passes or the task documents why existing pdx render/open tests already cover the shared failure path.

## Out of scope

- Pithos completion enforcement.
- pdx scaffold behavior.
- User `agents.toml` changes.
- Harness-specific subagent skill wiring.

## References

- `specs/artifact-contracts.md` section 4.
- `specs/agent-command-reference.md`.
- `specs/agent-configuration.md`.
- `packages/spawner/src/spawner.ts`.
- `packages/spawner/src/spawner.test.ts`.
- `packages/pithos/src/index.ts`.
