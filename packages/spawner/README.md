# @pdx/spawner

Developer map for the Spawner package: the Harness launcher for Pandora's Box Agent runs.

## Package role

`@pdx/spawner` is a library used by `pdx`. It also exposes one preview binary:

```sh
pandora-spawn --help
pandora-spawn preview --help
```

Preview renders the Agent run plan as JSON, including bundled prompt provenance, selected user policy packs, and user Harness overrides. It does not mutate Pithos, create a Run, touch tmux, or launch a Harness session.

For the actual agent manifest and prompt-template contract, see the repo-root
[`resources/`](../../resources/) directory and [`resources/README.md`](../../resources/README.md).

## Boundaries

Spawner owns:

- Agent manifest loading from bundled defaults plus `$PDX_USER_DATA_DIR/agents.toml`
- user policy-pack registry and `[policy]` / `[agents.<kind>.policy]` add/remove selection
- ordered `[[rules]]` policy selection by normalized launch path, path glob, scope kind, and Agent kind
- prompt rendering from bundled templates, including generated Markdown command references for `{{command_cards}}` and verbatim selected policy Markdown
- Harness argv/env construction
- expected Harness session log paths
- AFK mode process launch mechanics
- HITL mode tmux launch mechanics
- Claude/Pi transcript parsing for `pdx run transcript`; malformed or message-less logs fail loudly instead of rendering empty output, and Pi timeline tool-call entries render as in-flight tool summaries

Spawner does not own:

- durable Tasks, Runs, Claims, Fencing tokens, Artifacts, Events, or Task graph invariants — Pithos owns those
- Registry state, Kill, Cleanup, Interrupt, Nudges, or live Run finalization — `pdx` owns those
- claim/enqueue authorization truth — Pithos built-ins own that; Spawner derives render metadata from them
- task body routing — Agent runs claim Claimable tasks themselves via the rendered claim command

## Cross-package flow

```text
pdx reconcile
  -> Spawner.renderAgent(input)
  -> pdx stores rendered harness kind/session log path on a Pithos Run
  -> Spawner.launchRenderedAgent(rendered)
  -> pdx owns returned pid/tmux target in its Registry

pdx run transcript
  -> Pithos run inspect gives harness_kind + session_log_path
  -> Spawner.renderSessionTranscript(...) parses the Harness session log
```

Specs describe the full control plane: [`../../specs/control-plane-supervision.md`](../../specs/control-plane-supervision.md). Terms: [`../../UBIQUITOUS_LANGUAGE.md`](../../UBIQUITOUS_LANGUAGE.md).

## File map

| Path                        | Why read it                                                              |
| --------------------------- | ------------------------------------------------------------------------ |
| `src/index.ts`              | package-root exports; keep consumers on this boundary                    |
| `src/main.ts`               | process boundary, preview execution, and tagged CLI errors               |
| `src/cli.ts`                | `pandora-spawn preview` command surface and help rendering               |
| `src/spawner.ts`            | manifest contract, render pipeline, launch mechanics, transcript parsers |
| `src/services.ts`           | Render/Launch service interfaces, live Node IO, fake services            |
| `src/paths.ts`              | bundled data/user resource path helpers and argv path expansion roots    |
| `src/errors.ts`             | `SpawnerError` codes and CLI exit mapping                                |
| `src/help.ts`               | re-exports shared descriptor-driven terminal help renderer               |
| `../../resources/README.md` | manifest/template contract and operator-facing config docs               |
| `../../resources/`          | bundled default manifest and prompts seeded into `<data-dir>/templates/` |
| `src/spawner.test.ts`       | behavior examples for render, launch, transcript, and manifest failures  |

## Public library surface

Exported from `@pdx/spawner`:

- `renderAgent(input)` — pure render/validation. No launch.
- `launchRenderedAgent(rendered)` — launch an already-rendered plan.
- `launchAgent(input)` — convenience render-then-launch wrapper. `pdx` should prefer the two-step flow.
- `renderSessionTranscript(input)` — parse a stored Claude/Pi Harness session log, including Pi timeline tool-call previews when present.
- `loadHooks()` — read optional pdx hook config from bundled defaults plus `$PDX_USER_DATA_DIR/agents.toml`; scope directories, rules, and project-local `.pdx` files are not hook sources.
- `LiveSpawnerServices` — live filesystem/process/env implementation.
- `makeFakeSpawnerServices(input)` — deterministic service implementation for tests.
- `bundledTemplatesDir` — repo-root bundled default template directory used when `PDX_DATA_DIR` is unset and by `pdx` when seeding a fresh data dir.

`RenderedAgent` is the important API object: it contains `logicalName`, `harness.kind`, `harness.argv`, `harness.env`, `sessionLogPath`, and `prompt`. `prompt` includes a generated Markdown command reference for the `{{command_cards}}` template variable. Spawner sources syntax from structured CLI metadata (`pithos --help-json` and, for Pandora, selected `pdx --help-json` inspection/debug commands), applies role filters, validates configured command paths, validates built-in command annotations against the generated help tree, then renders concise Markdown. Pandora receives `pdx daemon status` / `logs` as debug-only cards alongside run transcript/show navigation. Human terminal help is rendered from the same Effect command descriptors via `@pdx/cli-help`, while the agent command reference uses `--help-json`; Spawner does not copy terminal help text into prompts. Malformed help JSON, configured command paths missing from help, or annotation paths missing from help fail render loudly. `LaunchResult` intentionally contains runtime metadata only: pid for AFK mode or tmux target/pane pid for HITL mode.

## Manifest/template config

Spawner intentionally keeps the render contract in the repo-root
[`resources/README.md`](../../resources/README.md) next to the bundled default
`agents.toml` and prompt templates themselves.

Use that doc for:

- `agents.toml` schema, merge semantics, and the built-in Pithos claim/enqueue contract Spawner derives at render time
- template variables and include rules, including `command_cards` as generated Markdown rather than raw JSON
- `PDX_DATA_DIR` loading behavior
- user-editable config guidance

## Harness notes

Read `src/spawner.ts` for exact argv construction. Stable behavior worth knowing before editing:

- `harness.argv` in `agents.toml` is an optional escape hatch: tokens are inserted after the binary name and before all Spawner-managed flags. Spawner applies only the documented `$PDX_DATA_DIR`, `$PDX_USER_DATA_DIR`, and leading-`~` path expansion; there is no shell evaluation. See [`resources/README.md`](../../resources/README.md) for the full contract.
- AFK mode uses Harness print mode with the message `Claim and process one task, then exit.`
- HITL mode launches under tmux.
- HITL prompt delivery uses a temp-file shell wrapper for every Harness to keep rendered prompts out of the `tmux new-session` argv.
- Session log paths are computed before launch and stored by `pdx` on the Pithos Run. For Claude, Spawner matches Claude Code's project bucket by resolving the launch CWD through `realpath` before slugging every non-alphanumeric/non-hyphen character to `-`.
- Launch failures are surfaced as tagged Spawner failures. Spawner does not cancel tasks or enqueue escalations; pdx classifies launch-precondition failures such as missing cwd before/around launch and owns the Pithos repair workflow.

## Development

```sh
pnpm --filter @pdx/spawner typecheck
pnpm --filter @pdx/spawner test
pnpm --filter @pdx/spawner start -- --help
pnpm --filter @pdx/spawner start -- preview --help
```

Preview with an isolated DB context:

```sh
export PITHOS_DB="$(mktemp -d)/pdx/pithos.sqlite"
mkdir -p "$(dirname "$PITHOS_DB")"
pnpm --filter @pdx/pithos start -- init --fresh
pnpm --filter @pdx/spawner start -- preview \
  --agent war \
  --mode afk \
  --scope scope_repo \
  --scope-kind repo \
  --scope-path "$PWD" \
  --run run_demo \
  --session-id 123e4567-e89b-12d3-a456-426614174000 \
  --cwd "$PWD" | jq .
```

If you want preview to use the same seeded bundled defaults as `pdx`, set
`PDX_DATA_DIR` and ensure `<data-dir>/agents.toml` plus `<data-dir>/templates/`
have already been seeded. User manifest prompt fields and same-path user
`templates/` files are rejected or ignored; only bundled prompt assets render.
User policy packs declared under `[policies.<id>]` may be selected with `[policy]`,
`[agents.<kind>.policy]`, `[[rules]].policy`, or
`[[rules]].agents.<kind>.policy` `add`/`remove`; selected Markdown is appended
verbatim after the bundled prompt and generated command reference. Rule predicates support
`path`, `path_glob`, `scope_kind`, and `agent`, and preview provenance reports the
normalized launch path plus matched rules.

Use fake services for deterministic render/launch tests. Do not require live model credentials for package tests.
