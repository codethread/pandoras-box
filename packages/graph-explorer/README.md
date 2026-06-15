# @pdx/graph-explorer

Developer documentation for the graph explorer package: the read-only browser dashboard boundary that `pdx ui` launches.

## Package role

`@pdx/graph-explorer` owns the explorer web boundary:

- the lifecycle API that `pdx` calls to start and stop the explorer
- the local HTTP server, static SPA asset serving, and websocket transport seam
- read-only graph, task, and daemon-status APIs backed by `@pdx/pithos`
- the client-only SPA shell, graph renderer, and inspector UX

## What this package is

- A private workspace package with a narrow public lifecycle boundary.
- The home of the explorer server, API parsing, daemon-status reads, websocket snapshot plumbing, and browser UI.
- A read-only operator UI package; it does not mutate Pithos.

## What this package is not

- Not the `pdx` CLI command surface. `pdx` owns user-facing command parsing and browser launch.
- Not a second graph model. Pithos remains the source of truth.
- Not a task mutation surface.

## Relation to other packages

| Package       | Integration                                              | Boundary                                                    |
| ------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| `@pdx/pdx`    | current caller of `startGraphExplorer(...)` via `pdx ui` | `pdx` owns CLI lifecycle and browser opening                |
| `@pdx/pithos` | source of graph/task read models                         | explorer stays read-only and imports package-root APIs only |

## Public package surface

Exported from `@pdx/graph-explorer`:

- `startGraphExplorer(options)`
- `GraphExplorerOptions`
- `GraphExplorerHandle`
- `ExplorerSelector`

Keep exports narrow; server/frontend internals stay private to this package.

## Current server surface

- `GET /api/health`
- `GET /api/config`
- `GET /api/graph`
- `GET /api/task/:taskId`
- `GET /api/daemon/status`
- `WS /ws/graph`

The graph API parses `selector`, repeated `status`, repeated `search`, relative `since`, and bounded absolute `since` + `until` ranges at the HTTP boundary. The websocket accepts `subscribe`, `set_selector`, and `refresh` messages and pushes graph snapshots, stale notices, and daemon-status updates.

## Runtime architecture

```text
pdx ui
  -> startGraphExplorer(...)
  -> local HTTP server + WS endpoint
  -> @pdx/pithos graph/task reads
  -> optional pdx daemon status socket read
  -> bundled SPA assets
  -> browser Graphology + Sigma canvas + layout worker
```

The explorer server polls graph state every 30 seconds for connected websocket selectors. Manual refresh uses the same read path immediately, while the SPA keeps the last successful graph visible if a later refresh goes stale.

## Websocket message contract

Server -> client messages:

- `snapshot` — latest graph snapshot revision
- `daemon_status` — `running`, `not_running`, or `unreachable` plus AFK/registry details when available
- `stale` — graph refresh failed after at least one successful snapshot; keep the last good graph visible
- `error` — structured protocol or read failure

Client -> server messages:

- `subscribe` — subscribe to the current selector/time filter
- `set_selector` — switch selector/filters and immediately refresh
- `refresh` — request an immediate refresh without changing the selector

## Current frontend

The bundled browser app is a client-only SPA with:

- header/status area for daemon status, websocket freshness, last update time, and refresh actions
- persisted browser-local settings for scope view, refresh cadence, relative windows, and bounded absolute time ranges
- manual refresh via HTTP plus websocket snapshot subscription for push updates
- visible stale/error state that keeps the last successful graph visible
- Graphology + Sigma.js graph rendering
- dagre layout in an ES module worker served from `/layout-worker.js`
- stable-id diffing that preserves selection and avoids relayout when only status/preview metadata changes
- branch highlighting/dimming around the selected task
- an inspector panel for task metadata, body, relationships, gates, context links, and artifact refs

Layout has no non-worker fallback: worker setup errors surface directly in the canvas.

## File map

```text
src/
  index.ts                # public lifecycle boundary
  errors.ts               # tagged package-local error contract
  types.ts                # public options/handle/selector types
  server/                 # HTTP, websocket, daemon status, Pithos reader seam
  frontend/
    frontend.ts           # SPA bootstrap/controller
    api.ts                # browser HTTP/WS parsing and fetch helpers
    components/           # HTML-string shell components
    graph/
      graph-canvas-controller.ts # Sigma lifecycle + worker/layout integration
      focus.ts            # branch highlight computation
      graph-diff.ts       # stable-id diff logic
      layout-adapter.ts   # relayout decision + worker request builder
      layout-worker.ts    # dagre worker entrypoint
      visual-style.ts     # capability/state/edge styling helpers
    stores/               # persisted settings, selection, websocket freshness helpers
scripts/build.mjs         # esbuild bundles for server/frontend/worker scaffold
```

## Development

```sh
pnpm --filter @pdx/graph-explorer typecheck
pnpm --filter @pdx/graph-explorer test
pnpm --filter @pdx/graph-explorer build
```

For full repo validation, use the root scripts; this package is wired into `pdx ui`.
