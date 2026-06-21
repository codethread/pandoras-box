# @pdx/spawner

Developer map for the Spawner package: the Harness launcher for Pandora's Box Agent runs.

## Package role

`@pdx/spawner` is a library used by `pdx`. It also exposes one preview binary:

```sh
pandora-spawn --help
pandora-spawn preview --help
```

Preview renders the Agent run plan as JSON, including bundled prompt provenance, selected user policy packs, and user Harness overrides. It does not mutate Pithos, create a Run, touch tmux, or launch a Harness session.

For the user configuration contract, see
[`specs/agent-configuration.md`](../../specs/agent-configuration.md) and the
installed reference at [`resources/user-data-dir/PANDORA.md`](../../resources/user-data-dir/PANDORA.md).

## Boundaries

Spawner owns:

- Agent manifest loading from bundled prompt defaults plus user-owned Harness/policy config in `$PDX_USER_DATA_DIR/agents.toml`
- user policy-pack registry and `[policy]` / `[agents.<kind>.policy]` add/remove selection
- ordered `[[rules]]` policy and Harness selection by normalized launch path, path glob, scope kind, and Agent kind
- prompt rendering from bundled templates, including generated Markdown command references, generated Artifact Contract guidance, and verbatim selected policy Markdown
- Harness argv/env construction
- expected Harness session transcript lookup metadata
- AFK mode process launch mechanics
- HITL mode tmux launch mechanics
- Claude/Pi transcript parsing for `pdx run transcript`; malformed or message-less logs fail loudly instead of rendering empty output, Pi timeline tool-call entries render as in-flight tool summaries, and Pi harness `errorMessage` stops render as explicit error lines. The test-only `fagent` Harness is transcript-unsupported and fails loudly if transcript rendering is requested.

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
| `../../resources/README.md` | resource ownership map and documentation boundary                        |
| `../../resources/`          | bundled prompt defaults and user config scaffolds                        |
| `src/spawner.test.ts`       | behavior examples for render, launch, transcript, and manifest failures  |

## Public library surface

Exported from `@pdx/spawner`:

- `renderAgent(input)` — pure render/validation. No launch.
- `launchRenderedAgent(rendered)` — launch an already-rendered plan.
- `launchAgent(input)` — convenience render-then-launch wrapper. `pdx` should prefer the two-step flow.
- `renderSessionTranscript(input)` — parse a stored Claude/Pi Harness session log, including Pi timeline tool-call previews when present and Pi harness `errorMessage` stops as explicit transcript lines. Pi transcript lookup also resolves timestamp-prefixed sibling logs (`<timestamp>_<sessionId>.jsonl`) when the stored legacy `<sessionId>.jsonl` path is missing, and still fails loudly on missing or ambiguous matches.
- `LiveSpawnerServices` — live filesystem/process/env implementation.
- `makeFakeSpawnerServices(input)` — deterministic service implementation for tests.
- `bundledTemplatesDir` — repo-root bundled default template directory used when `PDX_DATA_DIR` is unset and by `pdx` when seeding a fresh data dir.

`RenderedAgent` is the important API object: it contains `logicalName`, `harness.kind`, `harness.argv`, `harness.env`, `sessionLogPath`, and `prompt`. `prompt` includes generated Markdown command reference content for the `{{command_cards}}` template variable. Spawner sources syntax from structured CLI metadata (`pithos --help-json` and, for Pandora, selected `pdx --help-json` inspection/debug commands), applies role filters, validates configured command paths, validates built-in command annotations against the generated help tree, then renders concise Markdown. When `$PDX_USER_DATA_DIR/artifacts.toml` has applicable rules, Spawner appends a generated Artifact Contract section next to the command reference using the public `@pdx/pithos` parser; present-but-invalid artifact config fails render/preview loudly. Artifact rules are not configured through `agents.toml` or a template variable. Pandora receives `pdx daemon status` / `logs` as debug-only cards alongside run transcript/show navigation. `LaunchResult` intentionally contains runtime metadata only: pid for AFK mode or tmux target/pane pid for HITL mode.

## Policy and Harness config

Spawner intentionally keeps the durable user configuration contract in
[`specs/agent-configuration.md`](../../specs/agent-configuration.md), with a
machine-local editing guide installed from
[`resources/user-data-dir/PANDORA.md`](../../resources/user-data-dir/PANDORA.md).

Use those docs for:

- policy declarations and `policy.add` / `policy.remove` selection
- Agent-specific policy selection and ordered match rules
- Harness settings, rule-targeted Harness overrides, and supported argv path expansion
- preview provenance fields for matched rules, selected policy ids, policy files, Harness config, and rendered prompt

## Harness notes

Read `src/spawner.ts` for exact argv construction. Stable behavior worth knowing before editing:

- Supported Harness kinds are `claude`, `pi`, and the test-only `fagent`. `fagent` is for deterministic tests only; it is not bundled as a production default and should be selected only from test/user config with an explicit repo-local binary path.
- `harness.argv` in `agents.toml` is an optional escape hatch: tokens are inserted after the binary name and before all Spawner-managed flags. Spawner applies only the documented `$PDX_DATA_DIR`, `$PDX_USER_DATA_DIR`, and leading-`~` path expansion; there is no shell evaluation. For `fagent`, the first `harness.argv` token is the executable path (for example a repo-local built `packages/fagent/bin/fagent`), followed by any fagent-specific flags such as `--config`. See [`specs/agent-configuration.md`](../../specs/agent-configuration.md) for the full contract.
- AFK mode uses Harness print mode with the message `Claim and process one task, then exit.`
- HITL mode launches under tmux. `fagent` HITL launches run the configured fake script once and then keep the tmux session alive with `tail -f /dev/null`; if the fake script exits non-zero, the shell exits loudly instead.
- HITL prompt delivery uses a temp-file shell wrapper for every Harness to keep rendered prompts out of the `tmux new-session` argv.
- Session log paths are computed before launch and stored by `pdx` on the Pithos Run. For Claude, Spawner matches Claude Code's project bucket by resolving the launch CWD through `realpath` before slugging every non-alphanumeric/non-hyphen character to `-`. For Pi, Spawner passes the Pithos Harness session id through Pi's native `--session-id` flag and stores the legacy project-local `<sessionId>.jsonl` lookup anchor; transcript rendering also resolves newer timestamp-prefixed sibling files when that exact path is absent.
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

If you want preview to use the same seeded bundled prompt defaults as `pdx`, set
`PDX_DATA_DIR` and ensure `<data-dir>/agents.toml` plus `<data-dir>/templates/`
have already been seeded. Also set `PDX_USER_DATA_DIR` with Harness config for
the previewed Agent; bundled config does not choose a runtime. User policy packs declared under `[policies.<id>]` may
be selected with `[policy]`, `[agents.<kind>.policy]`, `[[rules]].policy`, or
`[[rules]].agents.<kind>.policy` `add`/`remove`; selected Markdown is appended
verbatim after the bundled prompt and generated command reference. Rule predicates
support `path`, `path_glob`, `scope_kind`, and `agent`, and preview provenance
reports the normalized launch path plus matched rules.

Use fake services for deterministic render/launch tests. Do not require live model credentials for package tests.
