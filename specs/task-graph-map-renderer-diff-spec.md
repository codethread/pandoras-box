# Diff spec: Pithos Task graph map renderer refinement

**Status:** Planned
**Last Updated:** 2026-05-20

## 1. Overview

### Purpose

Refine the existing readable `pithos graph inspect` output so it remains a Task graph relationship map while making edge direction, typed edge labels, gate members, and Supersession history explicit for agents reading the map.

### Goals

- Label every typed Task edge in readable graph output, including `after`.
- Make the parent-rooted layout explicit: referenced tasks are shown first, then incoming owner/follow-up tasks.
- Render gate members as computed branch-closure members, not ordinary graph children.
- Render Supersession as replacement history, not as a typed Task edge.
- Preserve the existing graph selection, closure, ordering, scope display, color behavior, and `--json` contract.

### Non-Goals

- No named graph views or `--view` flag.
- No changes to `graph inspect --json` shape or selector semantics.
- No held-task, claimability, next-action, sitrep, artifact, or task-body summaries.
- No changes to `task inspect` or `briefing` output.
- No broad redesign of Task graph storage, claimability, gate semantics, or Supersession semantics.

## 2. Design Decisions

- **Decision:** Refine the existing map renderer instead of adding alternate views.
  - **Rationale:** `graph inspect` is the relationship-map surface. Task-level handoffs belong to `task inspect`; agenda/sitrep summaries belong to `briefing`. Named views would expand the product surface without changing the underlying relationship question.

- **Decision:** Use durable edge-kind wording in readable labels: `after`, `about`, `repair`, and `gate [state]`.
  - **Rationale:** These terms match the DB, JSON, CLI flags, specs, and tests. Display aliases such as `repairs` read naturally but create a second vocabulary for agents to learn.

- **Decision:** Add an incoming-arrow cue to edge rows.
  - **Rationale:** The renderer is parent-rooted: it shows referenced tasks, then incoming owner tasks. The arrow keeps the durable edge direction visible without changing layout.

- **Decision:** Render gate members under explicit member headings.
  - **Rationale:** Gate members are computed branch-closure members, not typed edges from the gate owner. Bare nested rows make them look like ordinary child tasks and obscure gate semantics.

- **Decision:** Keep Supersession visually separate from typed Task edges.
  - **Rationale:** Supersession is replacement history, not a `task_edges.kind`. Rendering it as `↻ replaced-by` preserves that boundary.

## 3. Architecture

### Component structure

This is a renderer-contract change inside the existing Pithos package:

- `packages/pithos/src/engine/render.ts` — readable graph renderer.
- `packages/pithos/src/engine/types.ts` — existing graph output types; no shape change expected.
- `packages/pithos/test/render.test.ts` — renderer behavior and snapshot coverage.
- `packages/pithos/test/__snapshots__/render.test.ts.snap` — accepted readable graph output.

### Data flow

```text
Engine graphInspect
  -> GraphInspectOutput graph selection
  -> renderGraphInspectText
  -> readable map text
```

The planned work changes only the final render step.

## 4. Data Model

No DB or JSON data model changes. The renderer consumes the existing `GraphInspectOutput` shape.

## 5. Interfaces

### Readable text output

Readable `graph inspect` output starts with:

```text
# Task graph map
selector: <selector>
edges: owner/follow-up --kind--> referenced task
layout: referenced task, then incoming owners
legend: ↑ already shown · ↻ supersession history
```

Every incoming edge row is labeled with durable edge-kind wording and an incoming-arrow cue:

```text
- after ← task_child [execute] [blocked] (~) Child
- about ← task_notice [escalate] [done] Needs attention
- repair ← task_alert [escalate] [done] Repair alert
- gate [open] ← task_checkpoint [review] [queued] Checkpoint
```

Gate members render as computed member blocks:

```text
  branch members: all clear
```

```text
  open members:
    - member task_branch [queued]
```

```text
  broken members:
    - member task_branch [failed]
```

If a member canonicalizes to a different task id, append `canonical=<canonical-task-id>`.

Supersession renders as replacement history:

```text
↻ replaced-by <task line>
```

If the successor was already rendered elsewhere:

```text
↻ replaced-by ↑ <task-id> already shown
```

### JSON output

`pithos graph inspect --json` is unchanged.

## 6. Implementation Phases

### Phase 1: Renderer contract

- [ ] Add graph-map header and selector rendering.
- [ ] Label incoming `after` edges.
- [ ] Render all incoming edge rows with `<kind> ← <task line>`.
- [ ] Replace bare gate member rows with explicit member blocks.
- [ ] Replace terse Supersession marker with `↻ replaced-by` wording.
- [ ] Update renderer snapshots with the existing Vitest workflow.

### Phase 2: Canonical docs alignment

- [ ] Update `specs/task-graph.md` to clarify readable graph inspect is a relationship-map/topology/provenance surface.
- [ ] Update `packages/pithos/README.md` to describe the map-oriented readable renderer while keeping generated help as the CLI syntax source.

## 7. Code Locations

| File                                                     | Planned change                                       |
| -------------------------------------------------------- | ---------------------------------------------------- |
| `packages/pithos/src/engine/render.ts`                   | Modify readable graph map rendering.                 |
| `packages/pithos/test/render.test.ts`                    | Update renderer contract coverage.                   |
| `packages/pithos/test/__snapshots__/render.test.ts.snap` | Update accepted readable graph output snapshots.     |
| `specs/task-graph.md`                                    | Clarify graph inspect relationship-map boundary.     |
| `packages/pithos/README.md`                              | Clarify map-oriented readable graph output boundary. |

## 8. Open Questions

None for this planned slice.
