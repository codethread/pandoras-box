# Task 12: Refine graph map renderer

## Scope

Type: AFK

Refine the existing `pithos graph inspect` readable text renderer so it remains a relationship map but makes edge direction, typed edge labels, gate members, and Supersession history explicit.

## Must implement exactly

- Add a compact graph-map header before readable graph rows:
  - `# Task graph map`
  - selector rendered from the current graph selector
  - edge-direction note: `edges: owner/follow-up --kind--> referenced task`
  - layout note: `layout: referenced task, then incoming owners`
  - legend: `↑ already shown · ↻ supersession history`
- Label every incoming typed edge in the map, including `after` edges.
- Use durable edge-kind wording in readable labels:
  - `after`
  - `about`
  - `repair`
  - `gate [clear|open|broken]`
- Render incoming edge rows with a left-arrow cue, for example `<kind> ← <task line>`, so the parent-rooted tree does not hide edge direction.
- Replace bare gate member rows with explicit member blocks:
  - clear gate with no relevant listed members: `branch members: all clear`
  - open gate: `open members:` followed by `- member <task-id> [status]`
  - broken gate: `broken members:` followed by `- member <task-id> [status]`
  - append `canonical=<task-id>` only when the canonical task id differs from the displayed member id
- Replace the terse Supersession marker with explicit replacement-history wording:
  - render successors under superseded tasks as `↻ replaced-by <task line>`
  - preserve existing repeated-node behavior as `↑ <task-id> already shown`
- Preserve existing graph selection, closure behavior, node ordering, gate-member relevance filtering, color behavior, and scope path formatting.
- Update renderer tests and snapshots using the existing Vitest snapshot workflow.

## Done when

- `renderGraphInspectText` output starts with the graph-map header and legend.
- Snapshot coverage proves `after`, `about`, `repair`, and all three `gate` states are readable with explicit edge labels.
- Gate member rows no longer appear as bare child rows in readable graph output.
- Supersession output is visibly replacement history rather than another typed edge.
- Relevant Pithos renderer tests pass.

## Out of scope

- Adding `--view` or any named graph views.
- Changing `graph inspect --json` shape or graph selection semantics.
- Adding held-task, claimability, next-action, sitrep, artifact, or task-body summaries.
- Reworking scope/path display beyond preserving current behavior.
- Changing `task inspect` or `briefing` output.

## References

- `specs/task-graph-map-renderer-diff-spec.md`
- `specs/task-graph.md`
- `packages/pithos/src/engine/render.ts`
- `packages/pithos/src/engine/types.ts`
- `packages/pithos/test/render.test.ts`
- `packages/pithos/test/__snapshots__/render.test.ts.snap`
