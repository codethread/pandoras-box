# Task 9: Merge artifact specs

## Scope

Type: AFK

After implementation settles, fold the planned Artifact Contract delta specs into the living specs so the spec set describes implemented behavior rather than separate proposal fragments.

## Must implement exactly

- Update `specs/artifact-contracts.md` from Planned to Implemented, trimming proposal-only wording where code now carries implementation detail.
- Apply the relevant content from:
  - `specs/task-graph.delta.md`
  - `specs/control-plane-supervision.delta.md`
  - `specs/agent-command-reference.delta.md`
  - `specs/agent-configuration.delta.md`
- Keep detailed Artifact Contract rules centralized in `specs/artifact-contracts.md`; cross-link instead of duplicating.
- Update `specs/README.md` so status and delta entries reflect the final implemented state.
- Remove or clearly retire delta files once their content is merged.

## Done when

- Specs agree with implemented behavior for artifact contracts, artifact APIs, inspect/graph rendering, prompt composition, scaffolding, and clarify capability plumbing.
- No stale planned delta remains discoverable as active future work.
- `pnpm verify` passes or failures are unrelated to docs/spec changes and are documented in `tasks/README.md` Developer Notes.

## Out of scope

- Updating package READMEs or user-facing resource docs.
- Implementing behavior not completed by prerequisite tasks.
- Adding new Artifact Contract features beyond the implemented MVP.

## References

- `specs/artifact-contracts.md`.
- `specs/*.delta.md`.
- `specs/README.md`.
- `specs/task-graph.md`.
- `specs/control-plane-supervision.md`.
- `specs/agent-command-reference.md`.
- `specs/agent-configuration.md`.
