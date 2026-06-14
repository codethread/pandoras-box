# Technical plan: Pithos Graph Explorer

This is an implementation handoff plan for the planned `specs/graph-explorer.md` system. It is intentionally mechanical: expected package structure, interfaces, dependencies, and sequencing. The spec remains the durable product contract.

## References

- `specs/graph-explorer.md` — product/system contract.
- `packages/pdx` — user-facing CLI command, config loading, and browser launch lifecycle.
- `packages/pithos` — read-only Task graph and task inspection source of truth.
- `/Users/ct/dev/projects/cc-inspect` — frontend style and library-pattern reference. Agents may inspect and copy/adapt components/patterns from that repo during implementation.

## Architecture summary

`pdx ui` starts a local read-only dashboard server from a new package:

```text
pdx ui
  -> resolve pdx config and Pithos DB path
  -> choose localhost port
  -> start @pdx/graph-explorer server
  -> open default browser
  -> keep process alive until interrupted

@pdx/graph-explorer server
  -> serves esbuild-bundled SPA assets
  -> exposes graph/task/daemon-status read endpoints
  -> imports @pdx/pithos and runs read APIs directly
  -> polls graph every 30 seconds per active selector
  -> pushes snapshots to connected clients over websocket

SPA
  -> React + TanStack Router + React Query + Zustand + shadcn/Radix-style components
  -> Sigma.js + Graphology renderer
  -> dagre layout in an ES module Web Worker
  -> localStorage for user settings
```

## Workspace package

Create a new private workspace package:

```text
packages/graph-explorer/
  package.json
  tsconfig.json
  vitest.config.ts
  README.md
  scripts/
    build.mjs
  src/
    index.ts
    server/
      server.ts
      api.ts
      pithos-reader.ts
      daemon-status.ts
      websocket.ts
      static.ts
      schemas.ts
    frontend/
      index.html
      frontend.tsx
      index.css
      routes.tsx
      api.ts
      graph/
        graph-adapter.ts
        layout-worker.ts
        layout-types.ts
        graph-diff.ts
        visual-style.ts
      components/
        AppShell.tsx
        HeaderBar.tsx
        ScopePicker.tsx
        TimeRangePicker.tsx
        FilterDrawer.tsx
        GraphCanvas.tsx
        GraphLegend.tsx
        InspectorPanel.tsx
        DaemonStatusBadge.tsx
        ui/
          button.tsx
          dialog.tsx
          popover.tsx
          sheet.tsx
          command.tsx
      stores/
        graph-store.ts
        settings-store.ts
        selection-store.ts
        websocket-store.ts
        layout-store.ts
      lib/
        utils.ts
```

The file tree is a starting point, not a contract. Keep package exports narrow.

## Package manifest

`@pdx/graph-explorer` should:

- be private and ESM (`"type": "module"`)
- export only the library boundary from `src/index.ts`
- depend on `@pdx/pithos` via `workspace:*`
- use repo-standard scripts: `clean`, `lint`, `typecheck`, `test`, `build`
- use esbuild for both server and browser bundles

Expected frontend/runtime dependencies:

- `react`, `react-dom`
- `@tanstack/react-router`
- `@tanstack/react-query`
- `zustand`
- Radix/shadcn-style utilities: `radix-ui` or targeted Radix packages, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `sonner`
- graph stack: `sigma`, `graphology`, `dagre`
- schema parsing: prefer Effect Schema if ergonomic in this repo; otherwise use existing project parsing patterns. Do not leak unchecked `unknown` past IO boundaries.

Follow this repo's pnpm, TypeScript, eslint, Effect, fail-loud, and IO-boundary parsing rules. Do not import from sibling package `src/*` internals.

## TypeScript and TSX

The new package will need TSX support. Add package-local compiler options rather than changing repo-wide behavior unless implementation proves the root config must know TSX:

```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": {
		"jsx": "react-jsx",
		"types": ["node", "react", "react-dom"]
	},
	"include": ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts", "test/**/*.tsx", "vitest.config.ts"]
}
```

If root `pnpm typecheck` misses TSX or cannot typecheck the package from the root config, update root config deliberately and keep the change minimal.

## Public library interface

`packages/graph-explorer/src/index.ts` should export a small lifecycle API for `pdx`:

```ts
export type GraphExplorerOptions = {
	readonly pithosDbPath: string;
	readonly pdxDataDir: string;
	readonly host?: string;
	readonly port?: number;
	readonly openBrowser?: boolean;
	readonly initialSelector?: ExplorerSelector;
};

export type GraphExplorerHandle = {
	readonly url: string;
	readonly host: string;
	readonly port: number;
	readonly stop: () => Promise<void>;
};

export declare const startGraphExplorer: (
	options: GraphExplorerOptions,
) => Promise<GraphExplorerHandle>;
```

Exact shape can change during implementation, but keep the boundary lifecycle-oriented. `pdx` should not own graph API internals, websocket details, or frontend assets.

## `pdx` integration

Update `packages/pdx` to add a user-facing command:

```text
pdx ui [--data-dir <path>] [--host <host>] [--port <port>] [--no-open]
```

Expected behavior:

1. Parse CLI args through the existing Effect CLI command tree.
2. Load pdx config with the same data-dir precedence as other commands.
3. Ensure the Pithos DB path is known. Do not require `pdx open`.
4. If no port is provided, bind an available localhost port.
5. Call `startGraphExplorer(...)` from `@pdx/graph-explorer`.
6. Open the browser unless `--no-open` is set.
7. Wait until SIGINT/SIGTERM, then stop the server.

Do not include `pdx ui` in Agent-facing generated command references/system prompts for MVP. It is user-facing operator UI, not an Agent workflow primitive.

## Server design

Use Node HTTP/WebSocket primitives or a small dependency if it materially reduces complexity. Keep runtime IO in server-boundary modules.

Server responsibilities:

- Serve SPA assets and return `index.html` for client routes.
- Expose read-only JSON APIs.
- Maintain websocket clients.
- Poll Pithos every 30 seconds for active selectors and push graph snapshots.
- Respond to manual refresh requests immediately.
- Query daemon status opportunistically and report either status or `not_running`.
- Never mutate Pithos.

Recommended endpoints:

```text
GET /api/config
GET /api/graph?selector=global|all|scope:<id>|task:<id>&since=<range>&status=...
GET /api/task/:taskId
GET /api/daemon/status
WS  /ws/graph
```

Parse every request at the HTTP boundary. Bad inputs return structured errors; they do not coerce silently to broad defaults.

## Pithos integration

The server should construct a Pithos Engine once:

```ts
import { liveServices, makeEngine } from "@pdx/pithos";

const engine = makeEngine({
	config: { dbPath: pithosDbPath },
	services: liveServices,
});
```

Use read-only methods:

- `engine.scopeList({ all: false })`
- `engine.graphInspect({ taskId, scope, all, status, search, sinceCutoff })`
- `engine.taskInspect({ taskId })`
- `engine.briefing({ agent: undefined })` if dashboard counts need it

Use `parseGraphSinceCutoff` for existing relative/absolute single-cutoff behavior. For Grafana-style absolute ranges, add an explorer-level range parser and only pass through what Pithos can support initially, or extend Pithos graph inspect intentionally if true between-range filtering is required. Do not pretend an unsupported time range was applied.

## Daemon status

The explorer works without `pdx open`. It should still show daemon status:

- If the pdx socket is absent, show `Daemon: not running`.
- If the socket responds to status, show `Daemon: running` plus compact registry/AFK counts.
- If the socket exists but fails, show `Daemon: unreachable` with a structured error.

Keep this as a read-only server concern. If importing pdx IPC helpers would require exporting a new pdx library boundary, either add that boundary intentionally or implement a tiny local status client that speaks the existing documented socket request shape.

## Websocket protocol

Use a small discriminated-union protocol. Example message kinds:

Client to server:

```ts
{
	kind: ("subscribe", selector, filters);
}
{
	kind: "refresh";
}
{
	kind: ("set_selector", selector, filters);
}
```

Server to client:

```ts
{
	kind: ("snapshot", graph, generatedAt, selector, revision);
}
{
	kind: ("task", task);
}
{
	kind: ("daemon_status", status);
}
{
	kind: ("error", code, message);
}
{
	kind: ("stale", message, lastSuccessAt);
}
```

Use stable task ids, artifact ids, and edge identity keys on the client to diff snapshots and avoid rerender/layout churn.

## Frontend architecture

Copy the style and state patterns from `/Users/ct/dev/projects/cc-inspect` where useful:

- Dark-only Tailwind/shadcn visual language.
- Radix-backed `button`, `dialog`, `popover`, `sheet`, and `command` primitives.
- `cn(...)` helper using `clsx` + `tailwind-merge`.
- Top-level view component orchestrates layout and stores; child components stay mostly presentational.
- Zustand stores for UI/settings/selection/websocket state.
- Persist only reusable user preferences in localStorage.
- TanStack Query for HTTP reads and TanStack Router for client routes.
- Sonner toasts for connection/errors where appropriate.

Suggested routes:

```text
/                 global scope view
/scope/$scopeId   saved/shareable scope view
/task/$taskId     task-anchored graph view
/all              all-scopes graph view
```

Use localStorage for:

- scope view, default `global`
- refresh interval, default `30s`
- time filter, supporting relative windows and absolute start/end ranges
- panel widths / outline visibility if implemented
- visual preferences such as grouped/expanded branches

Each persisted setting needs a nearby clear/reset control.

## Graph rendering

Renderer stack:

- Graphology for graph model and traversal/filter helpers.
- dagre for initial DAG/layered layout.
- Sigma.js for WebGL rendering.
- ES module Web Worker for layout computation.

Layout worker rule:

- Use `new Worker(new URL("./layout-worker.ts", import.meta.url), { type: "module" })` or equivalent esbuild-supported module-worker bundling.
- Serve over `http://localhost`; do not support `file://`.
- No fallback path. If the module worker cannot load or parse its inputs, fail loudly and show an error state.

Client diffing rules:

- Nodes keyed by `task.id`.
- Artifacts keyed by `artifact.id`.
- Edges keyed by `${kind}:${from_task_id}->${to_task_id}` plus gate state where useful for visual refresh.
- Preserve positions for existing node ids.
- Layout only new/unpositioned nodes when practical; full relayout is acceptable for the first slice if selection/camera are preserved.

## UI layout expectation

Use a cc-inspect-like three-region layout:

```text
+--------------------------------------------------------------------------------+
| pdx ui  [Scope: global v] [Time: last 1h x] [Refresh 30s x] [Refresh now]      |
|        Daemon: running | WS: connected | Last update: 12:34:56                 |
+-------------------------+-------------------------------------+----------------+
| Filters / Legend        | Graph Canvas                        | Inspector      |
| - Evils                 |                                     | selected task  |
| - Status                |   Pandora(escalate)                 | status/scope   |
| - Capabilities          |      about --> Greed(design)        | body           |
| - Edge types            |                  after --> War      | artifacts      |
| - Broken/gated/running  |        gate(open) ==> checkpoint    | relationships  |
+-------------------------+-------------------------------------+----------------+
```

The center canvas is for pulse and topology. Rich content belongs in the inspector panel, not inside graph nodes.

## Visual semantics

Evils / agent kinds:

| Evil       | Capabilities                          | Suggested visual cue      |
| ---------- | ------------------------------------- | ------------------------- |
| Pandora    | `escalate`                            | purple crown/dot          |
| Envy       | `intake`, `clarify`                   | teal eye/dot              |
| Toil       | `triage`                              | blue hammer/dot           |
| Greed      | `design`, `review`                    | amber gem/dot             |
| War        | `execute`                             | red sword/dot             |
| pdx system | repair alerts/system-authored context | zinc/striped system badge |

Task state:

| State                          | Suggested visual cue |
| ------------------------------ | -------------------- |
| queued                         | muted gray node      |
| claimable                      | blue outline/accent  |
| claimed/running                | amber active ring    |
| done                           | green node/check     |
| failed/cancelled/dead-lettered | red/dark red node    |
| missing required artifacts     | small warning badge  |

Relationships:

| Edge         | Suggested visual cue                              |
| ------------ | ------------------------------------------------- |
| `after`      | solid arrow, normal dependency                    |
| `gate`       | thick/double arrow with `clear/open/broken` badge |
| `about`      | dotted contextual arrow                           |
| `repair`     | red dotted contextual arrow                       |
| `supersedes` | purple history arrow                              |

Branches:

- Selecting a task highlights its branch closure.
- Gate targets can expand/highlight their current branch members.
- Broken branches should be visually obvious with red edge/node accents.
- Dim unrelated nodes while branch focus is active.

## Build plan

Use one package build script with esbuild contexts for:

1. Server/library bundle consumed by `pdx` or emitted to `dist` if needed.
2. Browser SPA bundle.
3. Module worker bundle.
4. Static asset copy or inlining manifest.

This repo currently uses esbuild directly, not Vite. Keep that convention unless implementation proves it is not worth the complexity.

## Testing and validation

Tests should earn their place. Useful tests:

- Time-range parser: relative and absolute ranges, invalid input fails loudly.
- Graph API request parser: selector/status/since validation.
- Graph diff helper: preserves stable ids and detects changed status/edges.
- Layout worker pure adapter if separable from browser APIs.
- `pdx ui --no-open --port <port>` smoke-style test with an isolated Pithos DB if practical.

Manual smoke:

```sh
export PDX_DATA_DIR="$(mktemp -d)/pdx"
export PDX_USER_DATA_DIR="$(mktemp -d)/pdx-user-config"
export PITHOS_DB="$PDX_DATA_DIR/pithos.sqlite"
mkdir -p "$PDX_DATA_DIR" "$PDX_USER_DATA_DIR"
pnpm run build
pithos init --fresh
pdx init --data-dir "$PDX_DATA_DIR"
pdx ui --data-dir "$PDX_DATA_DIR" --no-open
```

Use this repo's normal verification before committing:

```sh
pnpm verify
```

## Implementation slices

1. Package scaffold and build pipeline for server, SPA, and module worker.
2. `pdx ui` command lifecycle with no-open/port options and browser launch.
3. Read-only Pithos graph/task API in explorer server.
4. SPA shell with cc-inspect-style theme/components/stores/router/query.
5. Websocket snapshot protocol with 30-second server polling and manual refresh.
6. Scope/time/refresh settings with localStorage and clear/reset controls.
7. Graphology/dagre/Sigma canvas with module-worker layout.
8. Inspector panel for selected task details and artifact refs.
9. Daemon status badge/API.
10. Focus/polish: branch highlighting, edge legends, status/evil badges, tests, docs.
