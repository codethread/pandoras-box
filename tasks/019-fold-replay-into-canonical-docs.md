# Task 19: Fold replay into canonical docs

## Scope

Type: AFK

After the replay implementation exists, fold the planned change spec into the durable living documentation and remove the temporary change-spec status from the system.

## Must implement exactly

- Update `specs/task-graph.md` to include implemented Task Replay semantics, `claim_sequence`, replay validation, replay events, and gate-release identity by claim sequence.
- Update `specs/control-plane-supervision.md` only where Repair Alert guidance changes from “supersede/replan/cancel” to include replay as the lightweight repair path.
- Update `UBIQUITOUS_LANGUAGE.md` with a concise Task Replay term and clarify its relationship to Supersession if needed.
- Update `packages/pithos/README.md` with the new schema/invariant notes and CLI surface.
- Update `specs/README.md` so `task-replay.md` is no longer presented as an active planned change spec after fold-in.
- Either remove `specs/task-replay.md` or mark it clearly superseded by `specs/task-graph.md`, following the repo's existing pattern for temporary change specs.

## Done when

- Canonical specs describe the implemented replay behavior without contradicting code.
- No active planned change-spec entry remains in `specs/README.md` for replay after fold-in.
- Package README and agent-facing docs align with the final CLI/help behavior.
- Docs validation is backed by the implementation tests from earlier tasks.

## Out of scope

- Do not change runtime behavior except for documentation corrections required by the implementation.
- Do not add new replay features beyond the implemented MVP.

## References

- `specs/task-replay.md`
- `specs/task-graph.md`
- `specs/control-plane-supervision.md`
- `specs/README.md`
- `UBIQUITOUS_LANGUAGE.md`
- `packages/pithos/README.md`
