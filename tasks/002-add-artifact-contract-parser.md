# Task 2: Add artifact contract parser

## Scope

Type: AFK

Add a Pithos-owned Artifact Contract parser and normalizer for `$PDX_USER_DATA_DIR/artifacts.toml`, exported through the public package boundary for Spawner reuse. This task creates parsing and normalized data only; it does not enforce completion gates or render prompts.

## Must implement exactly

- Parse only `$PDX_USER_DATA_DIR/artifacts.toml`; do not add fallback lookup paths.
- If `PDX_USER_DATA_DIR` is unset, return an empty contract with enforcement disabled.
- If `PDX_USER_DATA_DIR` is set but the directory cannot be inspected/read, fail loudly with a tagged error.
- If the directory exists but `artifacts.toml` is absent, return an empty contract.
- If the file exists, parse TOML at the IO boundary and validate:
  - only the top-level `artifacts` array is accepted
  - each rule has known `capability`, lower-snake-case `kind`, non-empty `title`, non-empty `body`
  - `required` is optional and defaults to `false`
  - duplicate `(capability, kind)` rules fail
  - unknown fields fail
- Export normalized types/helpers from `@pdx/pithos`, including a helper to select rules for a set of capabilities.

## Done when

- Unit tests cover missing env, missing file, invalid TOML, unknown fields, bad capability, bad kind, empty title/body, duplicate rules, required defaulting, and normalized output using capabilities available at the time this task runs.
- Spawner can import the parser/types from the public `@pdx/pithos` boundary without importing `src/*` internals.
- `pnpm --filter @pdx/pithos test` passes.

## Out of scope

- Completion enforcement.
- pdx scaffolding of `artifacts.toml`.
- Prompt rendering of Artifact Contract JSON.
- Path/scope/agent-specific artifact rules.

## References

- `specs/artifact-contracts.md` sections 3 and 4.
- `packages/pithos/README.md` public package surface guidance.
- `packages/pithos/src/config.ts`.
- `packages/pithos/src/services.ts`.
- `packages/pithos/src/index.ts`.
