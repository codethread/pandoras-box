# Task 13: Document graph map boundary

## Scope

Type: AFK

Update canonical docs so `pithos graph inspect` is described as a relationship-map surface, while task-level handoff details and sitrep/attention summaries remain owned by `task inspect` and `briefing`.

## Must implement exactly

- Update the Task graph spec wording for readable `graph inspect` to emphasize relationship map, topology, and provenance.
- Preserve the existing `graph inspect --json` contract wording as the structured graph output.
- Clarify that readable `graph inspect` does not own task bodies, artifacts, next-action hints, or agenda/sitrep summaries.
- Update the Pithos package README CLI/output contract section to mention the readable graph renderer is map-oriented.
- Fold the temporary diff spec into canonical docs by removing `specs/task-graph-map-renderer-diff-spec.md` and its specs index entry after its content is represented in `specs/task-graph.md` / `packages/pithos/README.md`.
- Keep terminology aligned with the durable model:
  - typed Task edges are `after`, `about`, `repair`, and `gate`
  - Supersession is replacement history, not a typed Task edge
  - gate members are computed branch-closure members, not ordinary child edges

## Done when

- `specs/task-graph.md` clearly distinguishes graph-map responsibilities from task-inspect and briefing responsibilities.
- `packages/pithos/README.md` describes readable `graph inspect` as a map-oriented renderer without documenting any named view suite.
- The docs do not introduce postponed UI variants or out-of-scope summaries.
- The temporary diff spec is removed from `specs/` and `specs/README.md` after being folded into canonical docs.
- Relevant docs references match the renderer contract from Task 12.

## Out of scope

- Implementing renderer changes.
- Adding new CLI flags.
- Updating agent prompt templates.
- Rewriting broader task graph semantics unrelated to readable graph-map output.

## References

- `specs/task-graph-map-renderer-diff-spec.md`
- `specs/task-graph.md`
- `packages/pithos/README.md`
- `UBIQUITOUS_LANGUAGE.md`
