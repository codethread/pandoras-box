# Agent Command Reference Rendering

**Status:** Implemented
**Last Updated:** 2026-06-11

## 1. Overview

### Purpose

Spawner renders generated Markdown command references into Agent prompts through the `{{command_cards}}` template variable. This gives Pandora, Envy, Toil, Greed, and War a concise, role-filtered command surface sourced from real CLI metadata instead of stale prompt prose or human-oriented help text.

### Goals

- Source command syntax from `pithos --help-json` and selected `pdx --help-json` metadata.
- Render compact Markdown optimized for Agent use.
- Filter commands by Agent kind and validate every configured path during render.
- Keep workflow judgment in templates while generated cards cover command syntax and stable command-specific notes.
- Fail loudly when help JSON is malformed, a configured command path disappears, or an annotation references an unknown command.

### Non-Goals

- No replacement for role templates or `common/base.md` workflow policy.
- No raw help JSON injection into prompts.
- No dependency on human `--help` formatting.
- No authorization policy in templates; Pithos built-ins own claim/enqueue truth.
- No generic documentation site.

## 2. Design Decisions

- **Decision:** Keep the `{{command_cards}}` variable name while rendering Markdown.
  - **Rationale:** Templates already use the variable; the implemented contract changes its content from raw JSON to prose/reference content.

- **Decision:** Use structured CLI metadata as the command source.
  - **Rationale:** Generated references drift less than hand-maintained prompt snippets and fail render when command paths disappear.

- **Decision:** Keep generated command reference separate from workflow policy.
  - **Rationale:** CLI metadata can describe flags and subcommands, but templates must explain when to escalate, supersede, cancel, or route work.

- **Decision:** Validate annotations against the generated command tree.
  - **Rationale:** Agent-facing notes are useful only if they are tied to commands that still exist.

- **Decision:** Render readable Markdown rather than complete JSON.
  - **Rationale:** Agents need a scannable prompt reference: command path, usage, purpose, and a few high-value notes.

## 3. Render Flow

```text
Spawner.renderAgent
  -> load bundled `agents.toml` + templates, then apply `$PDX_USER_DATA_DIR/agents.toml` policy and rules
  -> call pithos --help-json
  -> call pdx --help-json for Pandora-only pdx inspection commands
  -> parse and validate command trees
  -> validate role filters and annotations
  -> render filtered Markdown
  -> render applicable Artifact Contract guidance from the shared Pithos parser
  -> inject command cards as {{command_cards}} and append Artifact Contract guidance adjacent to them
```

Templates receive launch/self-claim context only. They do not receive Task bodies.

## 4. Role Filters

| Agent kind | Pithos command paths                                                              | pdx command paths                                                                             |
| ---------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `war`      | `pithos task`, `pithos graph`                                                     | none                                                                                          |
| `envy`     | `pithos scope`, `pithos task`                                                     | none                                                                                          |
| `toil`     | `pithos scope`, `pithos task`, `pithos graph`                                     | none                                                                                          |
| `greed`    | `pithos scope`, `pithos task`, `pithos graph`                                     | none                                                                                          |
| `pandora`  | `pithos scope`, `pithos task`, `pithos graph`, `pithos events`, `pithos briefing` | `pdx daemon status`, `pdx daemon logs`, `pdx run transcript`, `pdx run show`, `pdx task show` |

Pandora receives daemon status/log cards as debug-only inspection surfaces. Her template keeps normal sitrep on Pithos graph/briefing/task inspect and `pdx run transcript`; daemon status is for liveness questions or conflicting evidence, and daemon logs are for supervisor anomalies.

## 5. Rendered Shape

Generated content starts with a short provenance note, then groups leaf commands by tool. Each command includes full path, description, usage, and compact notes/examples when annotations exist.

Example shape:

````md
## Generated command reference

This reference is generated from CLI metadata. Use the rendered claim command above for the exact claim invocation for this run.

### Pithos

#### `pithos task inspect`

Show a single-task dossier; pass `--json` for structured metadata.

Usage:

```sh
pithos task inspect [--json] [--full] <task-id>
```

Notes:

- Default output is readable Markdown for one task: full body, compact active artifact refs, and direct local context only.
- Use `--full` to render active artifact bodies inline.
- Use `--json` only for exact fields, scripting, or token recovery; `--full --json` is invalid.
````

Artifact command cards document the implemented Artifact Contract API from CLI metadata:

- `pithos task artifact add <task-id> [--run <run-id>] --token <token> --kind <kind> --title <title> [--stdin]` requires the current task Fencing token, can mutate only the held Task, and requires lower-snake-case `kind`.
- `pithos task artifact reject <artifact-id> [--run <run-id>] --token <token> --reason <reason>` retires a mistaken active artifact from current task/graph views and required-artifact satisfaction without deleting history.
- `pithos task artifact list <task-id> [--json]` shows active and rejected artifact metadata, not bodies.
- `pithos task artifact show <artifact-id> [--json]` is the exact-id body/detail command.

### Artifact Contract prompt block

When user-owned `$PDX_USER_DATA_DIR/artifacts.toml` has applicable rules, Spawner appends a generated Artifact Contract section adjacent to the generated command reference. The section is not a user-editable template variable and does not change `agents.toml` template-variable ownership. It contains a short preamble plus minified normalized JSON for the selected/current Capability, or for all claimable Capabilities when no selected Capability is known. No applicable rules means no Artifact Contract section.

Spawner obtains parsed/normalized rules through the public `@pdx/pithos` Artifact Contract parser/normalizer, so prompt rendering and Pithos completion enforcement share validation logic. When `PDX_USER_DATA_DIR` is set and `artifacts.toml` exists but is invalid, render/open fails loudly.

Pandora's `pithos graph inspect` annotations summarize the implemented graph contract: graph inspect is for inventory/provenance/audit, briefing is for ready/blocked agenda, readable output is threaded task cards with title-based preview lines and artifact refs, filters narrow seeds before closure, JSON is for exact typed-edge fields, and scope graph views include attached global `about`/`repair`/checkpoint context when closure reaches it.

## 6. Template and Preview Interface

`{{command_cards}}` is the supported variable. Its rendered content is generated Markdown, not raw JSON. `{{command_reference}}` is not supported.

`pandora-spawn preview` returns a JSON `RenderedAgent`; the `prompt` field is the manual verification surface for command-card output. Preview validates bundled prompts, user policy config, and help metadata but does not mutate Pithos, create Runs, touch tmux, or launch a Harness.

## 7. Code Locations and Tests

- `packages/spawner/src/spawner.ts` — command tree parsing, role filters, annotations, Markdown rendering, and Artifact Contract prompt block rendering
- `packages/spawner/src/spawner.test.ts` — role filtering, raw-JSON regression coverage, annotation validation
- `specs/agent-configuration.md` — bundled prompt, policy-pack, and template variable contract
- `packages/pithos/src/cli.ts` — Pithos help JSON source
- `packages/pithos/src/artifact-contracts.ts` — shared Artifact Contract parser/normalizer used for prompt rendering
- `packages/pdx/src/main.ts` — pdx help JSON source
