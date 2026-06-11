# Delta: Agent Policy Configuration for Artifact Contracts

**Status:** Planned Delta
**Last Updated:** 2026-06-11
**Target Spec:** `specs/agent-configuration.md`
**Primary Spec:** `specs/artifact-contracts.md`

## Purpose

Update Agent Policy Configuration only where Artifact Contracts affect prompt composition. Artifact Contracts remain separate from `agents.toml`; this delta does not add artifact rules to the Agent manifest model.

## Required changes

### Prompt composition

Update the prompt render order to include a generated Artifact Contract block adjacent to generated command cards:

1. bundled Agent template
2. bundled shared runtime includes (`common/base.md`, `common/afk.md` or `common/hitl.md`)
3. generated command reference (`{{command_cards}}`)
4. generated Artifact Contract section, when applicable
5. selected policy packs in final order

The generated Artifact Contract section:

- is not a user-editable template variable
- is not configured through `agents.toml`
- is rendered by Spawner using the shared `@pdx/pithos` Artifact Contract parser/normalizer
- contains a short preamble plus minified normalized JSON for the selected/current Capability, or all claimable Capabilities when no selected Capability is known
- is omitted when no Artifact Contract rules apply

### Boundary clarification

Add a short boundary note:

- `agents.toml` remains Harness and policy-pack configuration only.
- `$PDX_USER_DATA_DIR/artifacts.toml` is the user-owned Artifact Contract file.
- Pithos owns completion enforcement; Spawner only renders the parsed guidance into prompts.

### Code locations

Add cross-references only if the target spec's code-location table needs them:

- `packages/spawner/src/spawner.ts` — renders generated Artifact Contract prompt section
- `@pdx/pithos` public boundary — Artifact Contract parser/normalizer used by Spawner
- `specs/artifact-contracts.md` — owns the Artifact Contract format and enforcement semantics
