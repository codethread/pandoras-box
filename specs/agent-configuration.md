# Agent Policy Configuration

**Status:** Implemented
**Last Updated:** 2026-06-11

## 1. Overview

### Purpose

Agent policy configuration defines how Spawner combines Pandora's Box's bundled Agent prompts with user-owned workflow policy and Harness launch settings. The bundled prompts are the stable Pithos operating contract: claim work, inspect graph/task state, respect scopes and fencing tokens, compose Pithos commands, and complete or fail held work. User configuration chooses the actual Harness for each Agent launch and adds policy packs for local workflow preferences such as git flow, review expectations, artifact habits, intake routing, release style, and organization context.

### Goals

- Keep bundled Agent prompts and shared Pithos operating rules as the non-shadowed foundation for every rendered Agent prompt.
- Let users compose workflow preferences through named policy packs rather than replacing prompt internals.
- Keep all user-wide and path-specific policy in a single user-owned `agents.toml` registry.
- Support project-specific behavior from the user config through explicit path and glob match rules.
- Require user config to choose Harness kind/model/prompt-mode for launched Agents so `pdx open` cannot silently pick a runtime.
- Preserve simple Harness customization for model, runtime kind, tools, argv, and system prompt mode, including path-targeted overrides for the actual Harness kind.
- Keep invalid config fail-loud: unknown keys, missing policy definitions, missing policy files, invalid list operations, bad match rules, and unsupported argv expansion with tagged errors.
- Keep Pithos as the durable source of authorization truth for Agent kinds, Capabilities, claims, enqueues, scopes, and graph transitions.

### Non-Goals

- No user replacement of bundled Agent templates, shared base prompts, generated command references, or built-in Pithos operating rules.
- No implicit file shadowing by path. A file existing at the same path as a bundled prompt has no effect.
- No prompt content merge language beyond ordered policy pack concatenation.
- No project-local `.pdx` config layer. Project-specific policy is selected from user config by path/glob rules.
- No scope-directory cascade. Scope kind is a match predicate in `agents.toml`, not a directory layout.
- No authorization policy in config. Pithos built-ins define which Agent kinds exist and what they may claim/enqueue.

## 2. Design Decisions

- **Decision:** Bundled prompts are fixed foundations, not configurable template references.
  - **Rationale:** Pandora's Box owns the tool contract. Allowing users to shadow `agents/*.md` or `common/base.md` makes it too easy to lose claim/fencing/scope/graph correctness and forces users to rewrite the manual the bundle already provides.

- **Decision:** Rename user prompt additions to policy packs.
  - **Rationale:** User files usually describe workflow policy, not reusable template internals. Naming the surface `policy` makes intent clear: users add instructions after the base prompt; they do not edit prompt composition machinery.

- **Decision:** Policies are declared by id in `agents.toml`.
  - **Rationale:** A policy id is auditable and explicit. Spawner does not discover arbitrary files or search for first matching names. A policy can be used only after `agents.toml` declares which files compose it.

- **Decision:** Policy file entries resolve relative to the manifest that declares them.
  - **Rationale:** This avoids silent shadowing. If a policy id is declared in `$PDX_USER_DATA_DIR/agents.toml`, its relative `files` entries are loaded under `$PDX_USER_DATA_DIR`; they are not searched through other roots.

- **Decision:** User config is centralized in `PDX_USER_DATA_DIR`.
  - **Rationale:** Users can version-control one config tree, review all workflow policy in one place, and target project-specific behavior with match rules instead of scattering `.pdx` directories across repositories.

- **Decision:** Path/glob match rules select project-specific policy.
  - **Rationale:** Most project customization is driven by where the Agent is launched. Matching recorded scope/cwd paths keeps project policy explicit without introducing another config layer or directory cascade.

- **Decision:** Keep `add` and `remove` list operations for policy selection.
  - **Rationale:** Users need a generic workflow policy and a way for narrower path rules to subtract it before adding project-specific policy. Full list replacement encourages taking ownership of the base composition and is not part of the policy surface.

- **Decision:** Keep Harness configuration separate from prompt policy.
  - **Rationale:** Choosing Claude/Pi, model, tools, argv, and prompt mode is launch configuration, not workflow policy. These fields remain in `agents.toml` but do not affect the bundled prompt foundation.

## 3. Directory Model

### Bundled runtime config

`$PDX_DATA_DIR` is pdx-owned runtime state. On `pdx init` and `pdx open`, pdx reseeds bundled runtime resources:

```text
$PDX_DATA_DIR/
  agents.toml        # bundled Agent prompt defaults; no Harness runtime defaults
  templates/         # bundled base prompts and shared includes, read-only/reseeded
  AGENTS.md          # minimal runtime note
  pithos.sqlite
  pdx.sock
  intake.sock       # present while pdx is open
  pdx.jsonl
  runs/
```

Bundled templates are loaded by Spawner directly from the canonical bundle. User files do not shadow these paths.

### User-owned config

`PDX_USER_DATA_DIR` is parsed from the environment. When unset, it defaults to `$PDX_DATA_DIR/config`.

```text
$PDX_USER_DATA_DIR/
  AGENTS.md          # direct-agent pointer, scaffolded once
  CLAUDE.md          # Claude direct-agent pointer, scaffolded once
  agents.toml        # user policy registry and Harness partials, scaffolded once
  PANDORA.md         # installed config reference, re-seeded on init/open
  artifacts.toml     # user-owned Artifact Contract guidance/completion rules
  policies/          # user-owned policy pack Markdown files
```

Path validation is part of config parsing:

- the resolved user data dir must not equal `$PDX_DATA_DIR`
- the resolved user data dir must not be an ancestor of `$PDX_DATA_DIR`
- an explicit `PDX_USER_DATA_DIR` inside `$PDX_DATA_DIR` is valid only when it resolves to `$PDX_DATA_DIR/config`
- outside `$PDX_DATA_DIR`, any absolute or `~/` user data dir is allowed

Users can run a direct Agent from this directory. `AGENTS.md` points that Agent to `PANDORA.md`, which documents the policy registry, preview command, and user-owned editing surface.

## 4. Resolution Model

Spawner resolves each launch from three inputs:

1. bundled Agent prompt defaults from `$PDX_DATA_DIR/agents.toml`
2. user policy/Harness config from `$PDX_USER_DATA_DIR/agents.toml`
3. launch context: Agent kind, scope kind, recorded scope path/cwd, run id, session id, selected capability when needed, and Pithos authorization-derived claims/enqueues

There is no project-local config discovery. Project behavior is selected by user-declared rules.

### Merge order

Within `$PDX_USER_DATA_DIR/agents.toml`, Spawner applies config in this order:

1. top-level defaults and Agent config
2. matching `[[rules]]` in file order
3. matching Agent-specific config inside those rules

Rules later in the file can remove policy ids added by earlier defaults/rules and can override Harness scalars selected by earlier defaults/rules.

### Match rules

A rule applies when every specified predicate matches the launch context. Supported predicates:

- `path` — exact normalized launch path match; supports `~` expansion
- `path_glob` — normalized path glob; supports `~` expansion
- `scope_kind` — one of `global`, `repo`, or `worktree`
- `agent` — one built-in Agent kind

Examples:

```toml
[[rules]]
path_glob = "~/work/**"
policy.add = ["perkbox"]

[[rules]]
path = "~/work/app/docs/docs-shared"
agents.toil.policy.remove = ["git-flow"]
agents.toil.policy.add = ["docs-release"]

[[rules]]
scope_kind = "worktree"
agent = "war"
agents.war.policy.add = ["worktree-execution"]

[[rules]]
path_glob = "~/dev/**"
agents.war.harness.kind = "pi"
agents.greed.harness.kind = "pi"

[[rules]]
path_glob = "~/work/**"
agents.war.harness.kind = "claude"
agents.greed.harness.kind = "claude"
```

Invalid globs, unsupported predicates, relative paths that cannot be normalized, and unknown Agent kinds fail validation.

### Policy rendering order

For a given Agent, the final policy list is ordered by merge sequence:

1. global policy defaults from `[policy]`
2. Agent policy from `[agents.<kind>.policy]`
3. matching rule-level `[rules.policy]` additions/removals
4. matching rule Agent policy additions/removals

Spawner reads each selected policy id in final order. For each policy id, it reads the declared `files` entries in order, joins them with `\n\n---\n\n`, and appends the result to the rendered prompt after bundled base content and generated command cards, also separated by `\n\n---\n\n`.

A policy id may appear at most once in the final list. Adding an already-present policy id or removing an absent policy id fails loudly.

## 5. `agents.toml` Contract

`agents.toml` is render and launch configuration, not durable authorization truth.

### Policy declarations

Every policy id used by `policy.add` must be declared:

```toml
[policies.git-flow]
files = ["policies/git-flow.md"]

[policies.perkbox]
files = ["policies/perkbox.md"]
```

Policy ids use lowercase kebab-case. `files` is a non-empty ordered array. Entries may be relative, absolute, or `~/...` paths:

- relative paths resolve under `$PDX_USER_DATA_DIR`
- absolute paths read exactly that path
- `~/...` expands to the current user's home directory

Missing policy files fail render loudly. Policy Markdown is appended verbatim in `files` order; Spawner does not render variables inside policy files.

### Policy selection

Policy lists support two operations:

- `add = [...]` — append policy ids
- `remove = [...]` — remove policy ids already selected

Supported policy selection fields:

- `[policy]` — policies for every Agent launch
- `[agents.<kind>.policy]` — policies for one Agent kind
- `[[rules]].policy` — policies for launches matching the rule
- `[[rules]].agents.<kind>.policy` — policies for one Agent kind when the rule matches

`replace` is not part of policy selection.

Example:

```toml
[policies.git-flow]
files = ["policies/git-flow.md"]

[policies.perkbox]
files = ["policies/perkbox.md"]

[policies.docs-release]
files = ["policies/projects/docs-release.md"]

[policy]
add = ["git-flow"]

[agents.greed.policy]
add = ["lightweight-artifacts"]

[[rules]]
path_glob = "~/work/**"
policy.add = ["perkbox"]

[[rules]]
path = "~/work/app/docs/docs-shared"
agents.toil.policy.remove = ["git-flow"]
agents.toil.policy.add = ["docs-release"]
```

### Harness configuration

Harness fields are user-owned launch config and may be declared globally for an Agent or under a matching rule's Agent-specific table. Bundled config does not choose a Harness; rendering a launch whose final config lacks `agents.<kind>.harness.kind` fails, so `pdx open` fails until at least Pandora's Harness is configured.

```toml
[agents.greed.harness]
kind = "claude"
model = "opus"
system_prompt_mode = "append"
tools.add = ["Skill"]
argv.add = ["--effort", "high", "--name", "Greed"]
```

Required scalar fields for a launched Agent are `kind`, `model`, and `system_prompt_mode`. Scalar fields replace earlier values when present, and matching rule values replace earlier scalar values:

- `agents.<kind>.harness.kind`
- `agents.<kind>.harness.model`
- `agents.<kind>.harness.system_prompt_mode`
- `rules.agents.<kind>.harness.kind`
- `rules.agents.<kind>.harness.model`
- `rules.agents.<kind>.harness.system_prompt_mode`

List fields use operation tables:

- `agents.<kind>.harness.tools.add`
- `agents.<kind>.harness.tools.remove`
- `agents.<kind>.harness.argv.add`
- `agents.<kind>.harness.argv.replace`
- `rules.agents.<kind>.harness.tools.add`
- `rules.agents.<kind>.harness.tools.remove`
- `rules.agents.<kind>.harness.argv.add`
- `rules.agents.<kind>.harness.argv.replace`

`tools` is a unique list: removing an absent tool or adding an already-present tool fails. `argv` preserves argv-array behavior, supports `add` and `replace`, and allows duplicate tokens. `argv` does not support `remove`.

Spawner applies only path-oriented expansion for `$PDX_DATA_DIR`, `${PDX_DATA_DIR}`, `$PDX_USER_DATA_DIR`, `${PDX_USER_DATA_DIR}`, `~`, and `~/...`; unsupported or unset `$VARS` fail render loudly. No shell evaluation, globbing, command substitution, or quote parsing is performed.

### External intake

External intake is not configured in `agents.toml`. While `pdx open` is running, pdx owns `<data-dir>/intake.sock`; producers write newline-delimited JSON `{ title, body }` events to that socket. Each valid event creates a global `intake` Task for Envy. Producer process lifecycle belongs to the user rather than Spawner or pdx manifest configuration.

## 6. Prompt Composition

Spawner renders prompts in this order:

1. bundled Agent template
2. bundled shared runtime includes (`common/base.md`, `common/afk.md` or `common/hitl.md`)
3. generated command reference (`{{command_cards}}`)
4. generated Artifact Contract section, when applicable
5. selected policy packs in final order

Bundled templates use simple `{{variable}}` substitutions. Unknown variables fail loudly. Policy packs are appended verbatim and do not receive template variables. The generated Artifact Contract section is rendered by Spawner using the shared `@pdx/pithos` parser/normalizer; it is not configured through `agents.toml` and is omitted when no rules apply. It contains a short preamble plus minified normalized JSON for the selected/current Capability, or for all claimable Capabilities when no selected Capability is known. Pithos owns completion enforcement; Spawner only renders parsed guidance into prompts. See `specs/artifact-contracts.md` for the Artifact Contract format and enforcement semantics.

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

Templates receive launch/self-claim context only. They do not receive Task bodies.

## 7. Lifecycle Ownership

`$PDX_USER_DATA_DIR` is user-owned. pdx may scaffold files when the directory is missing, but it must not overwrite existing user files except for the installed `PANDORA.md` reference.

`pdx init` and `pdx open` re-seed bundled canonical config/templates and scaffold missing user config files. `--clean` removes runtime state only. `--nuke` removes pdx-owned runtime/bundled state while preserving `$PDX_USER_DATA_DIR`.

## 8. Preview and Direct-Agent UX

`pandora-spawn preview` renders a single Agent plan from supplied launch context without mutating Pithos or starting a Harness. Preview output includes:

- final Harness config
- matched rules
- selected policy ids in order
- policy declaration file paths
- rendered prompt

A direct config-editing Agent can run from `$PDX_USER_DATA_DIR`, read `PANDORA.md`, edit `agents.toml` and policy files, then validate with `pandora-spawn preview`.

## 9. Code Locations

| File / Directory                            | Responsibility                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/spawner/src/manifest.ts`          | Parse user `agents.toml`, validate policy declarations/rules, merge policy and Harness config.                                              |
| `packages/spawner/src/paths.ts`             | Resolve bundled resources, user config roots, policy file paths, and argv path expansion.                                                   |
| `packages/spawner/src/spawner.ts`           | Render bundled prompts, generated command cards, generated Artifact Contract guidance, selected policies, Harness argv/env, and provenance. |
| `packages/spawner/src/main.ts`              | `pandora-spawn preview` CLI boundary.                                                                                                       |
| `packages/spawner/src/spawner.test.ts`      | Policy selection, rule matching, validation, prompt rendering, and preview provenance tests.                                                |
| `packages/pdx/src/config.ts`                | Parse `PDX_DATA_DIR`, `PDX_USER_DATA_DIR`, derived defaults, and invalid path relationships.                                                |
| `packages/pdx/src/live.ts`                  | Re-seed canonical config/templates and scaffold user config files.                                                                          |
| `packages/pdx/src/controller.ts`            | Preserve user config during clean/nuke and pass launch context to Spawner.                                                                  |
| `resources/README.md`                       | Resource ownership map and pointers to this spec plus installed user reference docs.                                                        |
| `resources/data-dir/`                       | Bundled canonical Agent prompt defaults, templates, and runtime `AGENTS.md` note.                                                           |
| `resources/user-data-dir/PANDORA.md`        | User-facing policy registry, external intake, preview, and lifecycle reference.                                                             |
| `resources/user-data-dir/`                  | User config scaffold files, `artifacts.toml`, and installed reference assets.                                                               |
| `packages/pithos/src/artifact-contracts.ts` | Public Artifact Contract parser/normalizer used by Spawner.                                                                                 |

## 10. Testing

Automated tests cover:

- Config path parsing for `PDX_DATA_DIR` and `PDX_USER_DATA_DIR`.
- Policy declaration validation: unknown ids, duplicate ids, invalid id syntax, missing files, unsupported relative paths, and unreadable files.
- Match rule validation and matching for exact path, glob path, scope kind, and Agent kind.
- Policy merge behavior: top-level defaults, Agent-specific defaults, ordered rules, add/remove behavior, duplicate final policy detection, and removing absent policies.
- Harness merge behavior: scalar replacement, rule-targeted scalar replacement, tool add/remove, argv add/replace, and path expansion.
- Prompt composition order: bundled base before generated command cards, generated Artifact Contract guidance when applicable, and policy packs.
- Missing user Harness configuration fails render/open loudly instead of selecting a bundled runtime.
- No user file can shadow bundled `agents/*.md` or `common/*.md` prompts.
- Removed hook configuration fails loudly as an unknown manifest field.
- `pandora-spawn preview` provenance for matched rules and selected policies.

Manual smoke validation uses isolated `PDX_DATA_DIR`, `PDX_USER_DATA_DIR`, `PITHOS_DB`, and `TMUX_TMPDIR` as described in `AGENTS.md`.

## 11. Open Questions

None.
