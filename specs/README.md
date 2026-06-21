# Specifications

Persistent domain specifications. Organized by holistic system area, not feature chronology. Specs reference code at module level; each package README documents its own module boundaries.

## Durable work and control plane

| Spec                                                               | Status      | Purpose                                                                                                                                                    | Code                                                         |
| ------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [task-graph.md](./task-graph.md)                                   | Implemented | The durable Task graph: Scopes, Tasks, Claims, typed Task edges, Supersessions, Task Replay, Artifact lifecycle, completion gates, Events, and inspection. | `packages/pithos`                                            |
| [rfcs/beads-as-durable-layer.md](./rfcs/beads-as-durable-layer.md) | Draft       | RFC evaluating Beads as a replacement durable work graph substrate while keeping pdx as the control-plane policy layer.                                    | `packages/pithos`, `packages/pdx`                            |
| [artifact-contracts.md](./artifact-contracts.md)                   | Implemented | User-owned Artifact Contracts: artifact guidance config, required-artifact completion gates, fenced artifact mutation, rejection, and inspection APIs.     | `packages/pithos`, `packages/spawner`, `packages/pdx`        |
| [control-plane-supervision.md](./control-plane-supervision.md)     | Implemented | The Control plane across Pithos, Spawner, and pdx: supervision, Registry, Agent lifecycle, Repair Alerts, Nudges, external intake, operator interfaces.    | `packages/pdx`, `packages/spawner`, `packages/pithos`        |
| [agent-configuration.md](./agent-configuration.md)                 | Implemented | The user-facing configuration contract: policy packs, centralized `agents.toml` manifest, Harness settings, directories, and preview UX.                   | `packages/spawner`, `packages/pdx`, `resources`              |
| [prompt-rendering.md](./prompt-rendering.md)                       | Implemented | Spawner's internal prompt assembly: composition pipeline, template variables, role-filtered generated command cards, and the Artifact Contract block.      | `packages/spawner`                                           |
| [harness-contract.md](./harness-contract.md)                       | Implemented | The required and beneficial behavior a replaceable AI Harness must provide for Spawner/pdx supervision.                                                    | `packages/spawner`, `packages/pdx`                           |
| [graph-explorer.md](./graph-explorer.md)                           | Planned     | User-facing local web dashboard for read-only visual Pithos Task graph inspection, refresh, and drill-down.                                                | `packages/graph-explorer`, `packages/pdx`, `packages/pithos` |

## Retired artifact-contract deltas

The artifact-contract delta files were merged into the living implemented specs on 2026-06-11 and removed so no stale planned future work remains discoverable as active scope. Detailed Artifact Contract rules are centralized in [artifact-contracts.md](./artifact-contracts.md); related specs cross-link rather than duplicate the full contract.
