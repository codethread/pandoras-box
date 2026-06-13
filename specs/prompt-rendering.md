# Agent Prompt Rendering

**Status:** Implemented
**Last Updated:** 2026-06-12

## 1. Overview

### Purpose

Spawner assembles every Agent prompt from bundled templates, generated content, and user policy packs. This spec owns the internal rendering domain: the composition pipeline, template variables, the generated Markdown command reference, role filters, and the generated Artifact Contract block. The user-facing configuration contract that feeds rendering — directories, `agents.toml`, policy packs, Harness settings — is owned by [agent-configuration.md](./agent-configuration.md).

### Goals

- Assemble prompts deterministically: bundled foundation, then generated content, then user policy packs.
- Source command syntax from `pithos --help-json` and selected `pdx --help-json` metadata instead of stale prompt prose or human-oriented help text.
- Render compact Markdown command cards filtered by Agent kind, with every configured path validated during render.
- Keep workflow judgment in templates and policy packs while generated cards cover command syntax and stable command-specific notes.
- Fail loudly when help JSON is malformed, a configured command path disappears, an annotation references an unknown command, or a template uses an unknown variable.

### Non-Goals

- No raw help JSON injection into prompts.
- No dependency on human `--help` formatting.
- No authorization policy in templates; Pithos built-ins own claim/enqueue truth.
- No user-editable composition machinery: policy selection and Harness config are owned by [agent-configuration.md](./agent-configuration.md), and Artifact Contract semantics are owned by [artifact-contracts.md](./artifact-contracts.md).
- No Task bodies in prompts: templates receive launch/self-claim context only.

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

## 3. Prompt Composition

Spawner renders prompts in this order:

1. bundled Agent template
2. bundled shared runtime includes (`common/base.md`, `common/afk.md` or `common/hitl.md`)
3. generated command reference (`{{command_cards}}`)
4. generated Artifact Contract section, when applicable
5. selected policy packs in final order

Bundled templates use simple `{{variable}}` substitutions. Unknown variables fail loudly. Policy packs are appended verbatim and do not receive template variables. Which policy packs are selected, and in what order, is owned by [agent-configuration.md](./agent-configuration.md).

### Template variables

Available bundled template variables:

- `agent`
- `run_id`
- `session_id`
- `scope_id`
- `cwd`
- `claim_command`
- `command_cards`
- `claims` (derived from built-in Pithos authorization)
- `enqueues` (derived from built-in Pithos authorization)
- `model`
- `tools_csv`

`{{command_cards}}` is the supported command-reference variable; its rendered content is generated Markdown, not raw JSON. `{{command_reference}}` is not supported. Templates receive launch/self-claim context only. They do not receive Task bodies.

## 4. Command Reference Generation

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

## 5. Role Filters

| Agent kind | Pithos command paths                                                              | pdx command paths                                                                             |
| ---------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `war`      | `pithos task`, `pithos graph`                                                     | none                                                                                          |
| `envy`     | `pithos scope`, `pithos task`                                                     | none                                                                                          |
| `toil`     | `pithos scope`, `pithos task`, `pithos graph`                                     | none                                                                                          |
| `greed`    | `pithos scope`, `pithos task`, `pithos graph`                                     | none                                                                                          |
| `pandora`  | `pithos scope`, `pithos task`, `pithos graph`, `pithos events`, `pithos briefing` | `pdx daemon status`, `pdx daemon logs`, `pdx run transcript`, `pdx run show`, `pdx task show` |

Pandora receives daemon status/log cards as debug-only inspection surfaces. Her template keeps normal sitrep on Pithos graph/briefing/task inspect and `pdx run transcript`; daemon status is for liveness questions or conflicting evidence, and daemon logs are for supervisor anomalies.

## 6. Rendered Shape

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

Artifact mutation/inspection commands render as ordinary command cards from CLI metadata; their semantics (fenced held-task ownership, Fencing tokens, lower-snake-case kinds, rejection) are owned by [artifact-contracts.md](./artifact-contracts.md).

Pandora's `pithos graph inspect` annotations summarize the implemented graph contract: graph inspect is for inventory/provenance/audit, briefing is for ready/blocked agenda, readable output is threaded task cards with title-based preview lines and artifact refs, filters narrow seeds before closure, JSON is for exact typed-edge fields, and scope graph views include attached global `about`/`repair`/checkpoint context when closure reaches it.

## 7. Artifact Contract Block

When user-owned Artifact Contract rules apply to the launch, Spawner appends a generated Artifact Contract section adjacent to the generated command reference. The section is not a user-editable template variable, is omitted when no rules apply, and is rendered through the public `@pdx/pithos` parser/normalizer so prompt rendering and Pithos completion enforcement share validation logic; an invalid `artifacts.toml` fails render/open loudly.

Rule selection, the preamble text, the normalized JSON payload shape, and enforcement semantics are owned by [artifact-contracts.md](./artifact-contracts.md).

## 8. Verification

`pandora-spawn preview` is the manual verification surface for rendered prompts: it returns a JSON `RenderedAgent` whose `prompt` field shows the full composition, validating bundled prompts, user policy config, and help metadata without mutating Pithos, creating Runs, touching tmux, or launching a Harness. The preview command and its user-facing workflow are owned by [agent-configuration.md](./agent-configuration.md).

Rendering lives in `packages/spawner`; the Pithos and pdx CLIs are the help JSON sources, and `packages/pithos` exports the shared Artifact Contract parser used for the prompt block.
