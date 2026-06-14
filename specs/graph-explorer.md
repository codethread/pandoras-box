# Pithos Graph Explorer

**Status:** Planned
**Last Updated:** 2026-06-14

## 1. Overview

### Purpose

The Pithos Graph Explorer is a local, user-facing dashboard for periodically checking the durable Task graph without asking Pandora or running repeated CLI inspections. It presents a read-only visual view of Task status, relationships, artifacts, and selected task detail while preserving Pithos as the source of truth. The explorer is launched by `pdx`, implemented as a separate package, and reads Pithos through its library boundary.

### Goals

- Provide a browser-based read-only graph dashboard for human operators.
- Show current Task graph state: running/claimed work, queued work, blocked/gated branches, broken work, completed work, scopes, capabilities, and typed Task edges.
- Start from the user-facing `pdx ui` command that selects an available localhost port, starts the explorer server, and opens the browser.
- Keep `pdx ui` out of Agent-facing system prompts and generated command cards unless a future Agent-facing use case is explicitly designed.
- Follow the implementation handoff in `plans/graph-explorer-technical-plan.md` while treating this spec as the durable product contract.
- Keep graph data fresh through low-frequency server polling and websocket pushes to the SPA, with a manual refresh control.
- Preserve client-side UI state across refreshes where stable graph ids allow it: selected task, camera position, node positions, and expanded panels.
- Reuse Pithos graph and task inspection read models instead of duplicating graph semantics.
- Leave a future path to event-driven updates without changing the client transport model.

### Non-Goals

- No task mutation, graph editing, replay, supersession, completion, cancellation, or artifact mutation from the first explorer.
- No live log tailing or real-time terminal/session streaming.
- No export surface for Mermaid, Graphviz, or other static diagrams; the existing CLI graph view remains the text/export-adjacent inspection surface.
- No server-side rendering or hydration requirement; the browser client is a client-only SPA.
- No new durable graph model separate from Pithos.
- No websocket dependency on Pithos event emission for the first slice; polling is sufficient.

## 2. Design Decisions

- **Decision:** The explorer is user-facing and launched through `pdx ui`.
  - **Rationale:** `pdx` is already the operator entrypoint for opening, closing, and inspecting the local control plane. `pdx ui` is short, memorable, and high-yield for users. The dashboard is an operator convenience, not an Agent prompt surface or Pithos state transition, so it should not appear in Pandora-facing system prompts by default.

- **Decision:** The explorer implementation lives in a new package, not inside the `pdx` package.
  - **Rationale:** The UI server, websocket transport, static asset bundling, and browser code are a distinct product boundary. Keeping them separate prevents frontend dependencies and web-server lifecycle code from bloating the supervisor package while still allowing `pdx` to import a small library interface.

- **Decision:** `pdx` owns command lifecycle, port selection, and browser opening; the explorer package owns HTTP, websocket, static serving, and graph APIs.
  - **Rationale:** This preserves `pdx` as the local supervisor/operator CLI while giving the explorer package a cohesive web boundary. The imported interface should be small enough that `pdx` does not need to know graph rendering or API details.

- **Decision:** The explorer server imports Pithos as a library for read-only graph and task inspection.
  - **Rationale:** Pithos owns Task graph semantics and already exposes typed library boundaries. Calling Pithos directly avoids shelling out, avoids subprocess JSON parsing, and avoids making `pdx` a proxy owner of graph semantics.

- **Decision:** The first update model is server polling every 30 seconds plus websocket push to clients, with manual refresh.
  - **Rationale:** The project owns both server and client, so websocket push is low additional complexity over client polling. Server polling keeps the implementation independent of event-stream semantics while establishing the same client transport that can later carry proactive updates from Pithos or `pdx` events. The default polling interval is 30 seconds and is user-adjustable in browser-local settings.

- **Decision:** The explorer defaults to the global scope view and persists user view settings in browser local storage.
  - **Rationale:** Global gives first-time users the broadest control-plane pulse. Persisting scope, refresh interval, and time-filter preferences locally makes repeat check-ins fast without introducing durable Pithos/user-config state for UI preferences.

- **Decision:** `pdx ui` should work without `pdx open`, but should surface daemon status when available.
  - **Rationale:** Read-only graph inspection only needs an initialized Pithos database, so requiring the supervisor daemon would unnecessarily block offline/after-the-fact inspection. When the daemon is running, showing its status helps users understand whether the graph is actively supervised or merely historical/stale.

- **Decision:** Transcript and session evidence are out of the MVP.
  - **Rationale:** The first dashboard should optimize for graph pulse: task statuses, relationships, filters, and selected task detail. Transcript/session rendering can be added later without changing the graph explorer boundary.

- **Decision:** The client diffs incoming graph payloads by stable ids.
  - **Rationale:** Pithos graph JSON carries stable task ids, artifact ids, and typed edge identities. Diffing by those ids lets the UI avoid unnecessary rerenders and layout churn, preserving selection, camera, and node placement across periodic refreshes.

- **Decision:** The browser client is a bundled SPA, built with esbuild.
  - **Rationale:** The explorer does not need SSR. The repo already uses esbuild for package builds, so a static SPA bundle keeps the runtime simple and consistent with existing tooling.

- **Decision:** The primary visual renderer should be Sigma.js with Graphology and dagre-style layout, unless implementation findings prove Cytoscape.js is materially simpler.
  - **Rationale:** The expected graph size is hundreds to low-thousands of nodes. Sigma's WebGL renderer gives headroom, Graphology gives a graph data/algorithm layer, and dagre provides a reasonable initial DAG layout. Cytoscape.js remains the credible fallback if one-engine layout and interaction outweigh Sigma's performance headroom.

- **Decision:** Layout computation runs locally in a browser ES module Web Worker.
  - **Rationale:** Layout is client/view state, not durable graph state. Running layout in a module worker keeps the UI responsive and preserves a clean boundary between Pithos graph data and browser-specific coordinates. The explorer is served from local HTTP, so module workers are part of the expected runtime setup; there is no fallback path for `file://` or non-worker operation.

## 3. Domain Concepts

### Explorer server

A local, short-lived web server started by a `pdx` command. It serves the SPA, exposes read-only graph/task API endpoints, maintains connected websocket clients, polls Pithos on an interval, and pushes graph snapshots to clients.

The server is not a daemon-owned durable service by default. It lives for the duration of the foreground `pdx` command that launched it unless a later design explicitly adds daemon integration.

### Graph snapshot

A point-in-time read-only representation of the Pithos Task graph for a selector. The snapshot should mirror the `graph inspect --json` contract closely enough that agents and developers can reason about one graph model across CLI and UI surfaces.

Snapshots are replaceable observations, not durable records. The database remains the source of truth.

### Client graph state

The SPA maintains view-local state in browser local storage where it improves repeat visits, and otherwise in memory:

- selected task
- camera and zoom
- node positions/layout hints
- active filters
- selected scope view, defaulting to global
- refresh interval, defaulting to 30 seconds
- time filter, supporting relative windows such as “last 1 hour” and absolute ranges between two timestamps
- expanded inspector sections
- websocket freshness/error state

Each persisted setting must have a clear/reset control near the setting it affects. When a new graph snapshot arrives, the client updates graph data by stable ids and preserves view state when the referenced entities still exist.

### Visual model

The UI should make four things legible at a glance: Evils, task state, branch focus, and relationship type.

Evils are shown as capability/agent-kind badges rather than as separate graph entities:

| Evil       | Capabilities                            | Visual role                           |
| ---------- | --------------------------------------- | ------------------------------------- |
| Pandora    | `escalate`                              | human attention / routing             |
| Envy       | `intake`, `clarify`                     | intake and requirements clarification |
| Toil       | `triage`                                | decomposition and routing             |
| Greed      | `design`, `review`                      | HITL design and review                |
| War        | `execute`                               | implementation work                   |
| pdx system | repair alerts / system-authored context | supervision and repair signals        |

Task state should be encoded by node color/border:

| State                          | Visual role                                     |
| ------------------------------ | ----------------------------------------------- |
| queued                         | waiting work                                    |
| claimable                      | ready work, highlighted with an accent outline  |
| claimed/running                | active work, highlighted as currently in motion |
| done                           | completed work                                  |
| failed/cancelled/dead-lettered | broken or intentionally stopped work            |

Relationships should use edge style, not prose labels alone:

| Edge         | Visual role                                                      |
| ------------ | ---------------------------------------------------------------- |
| `after`      | solid dependency arrow                                           |
| `gate`       | heavier checkpoint arrow with `clear`, `open`, or `broken` state |
| `about`      | dotted context/attention arrow                                   |
| `repair`     | red dotted broken-work attention arrow                           |
| `supersedes` | history/replacement arrow                                        |

Selecting a task highlights its branch closure, dims unrelated work, and lets gate targets reveal their current branch members. Broken branches should be visually obvious without requiring the user to open the inspector.

The rough layout is:

```text
+--------------------------------------------------------------------------------+
| pdx ui  Scope: global [clear]  Time: last 1h [clear]  Refresh: 30s [clear]     |
|         [Refresh now]  Daemon: running/not running  WS: connected  Updated ... |
+-------------------------+-------------------------------------+----------------+
| Filters / Legend        | Graph canvas                        | Inspector      |
| - Evils                 |                                     | selected task  |
| - Status                |   Pandora escalate                  | status/scope   |
| - Capability            |      about ....> Greed design       | body           |
| - Edge types            |                    after --> War    | relationships  |
| - Broken/gated/running  |        gate(open) ==> checkpoint    | artifacts      |
+-------------------------+-------------------------------------+----------------+
```

The graph canvas is for pulse and topology. Rich task content belongs in the inspector panel, not inside graph nodes.

### Freshness model

The first explorer has two refresh paths:

| Path              | Initiator       | Contract                                                                                                              |
| ----------------- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| Scheduled refresh | Explorer server | Every 30 seconds, rerun the Pithos graph read for active selectors and push the latest snapshot to connected clients. |
| Manual refresh    | Browser user    | Request an immediate graph refresh and update the current client when the read completes.                             |

Future event-driven refresh may trigger the same push path from Pithos or supervisor events. That future should not require a client protocol redesign.

## 4. Interfaces

### `pdx ui` user command

The command contract should be:

- load normal `pdx` config, including the Pithos DB path
- select an available localhost port unless a port is explicitly provided
- start the explorer server through the new package's library interface
- open the default browser to the explorer URL unless disabled
- keep the foreground process alive until interrupted

### Explorer package library interface

The explorer package should expose one small lifecycle-oriented entrypoint to `pdx`, conceptually:

```ts
startGraphExplorer(options): ExplorerHandle
```

The options must include the Pithos database/config needed for read-only inspection, host/port preferences, and initial graph selector defaults. The handle must provide the bound URL and a way to stop the server.

The exact TypeScript shape belongs in code; the durable contract is that `pdx` starts and stops the explorer without owning web internals.

### HTTP and websocket surface

The first server surface should include:

| Interface              | Purpose                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Static SPA routes      | Serve the bundled HTML, JavaScript, and CSS assets.                                                                    |
| Graph read endpoint    | Return the current graph snapshot for a selector; also used by manual refresh.                                         |
| Task read endpoint     | Return selected task detail using Pithos task inspection semantics.                                                    |
| Daemon status endpoint | Return `running`, `not_running`, or `unreachable` status for the local pdx daemon without making the daemon mandatory. |
| Websocket endpoint     | Push graph snapshots, freshness metadata, and error/stale notifications to connected clients.                          |

API responses should use Pithos terms: Task, Scope, Capability, typed Task edge, Artifact, Supersession, Gate, and Branch. Errors should be structured enough for the UI to show stale state rather than clearing the graph.

## 5. Open Questions

- None currently.

### Resolved during design review

- The user command is `pdx ui`.
- The default scope view is global.
- Browser local storage stores user UI settings, including refresh interval, scope view, and time filter.
- Time filtering supports relative windows such as “last 1 hour” and absolute ranges between two timestamps.
- Each stored setting has a clear/reset control.
- The explorer does not require `pdx open`, but should ping or query daemon status and display that status in the UI when possible.
- Transcript and session evidence are out of scope for the MVP.
- Layout computation runs locally in a browser ES module Web Worker with no fallback mode.
