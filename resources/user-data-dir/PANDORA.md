# Pandora's Box config reference

This file is installed into `<user-data-dir>/PANDORA.md` by `pdx init` / `pdx open`.
It is bundle-owned reference material and may be overwritten on upgrade or re-init.
Do not customize Pandora's Box here; put your changes in user-owned config files instead.
If you version-control your config directory, add `PANDORA.md` to `.gitignore` unless you intentionally track bundled reference docs.

## What Pandora's Box is

- `pdx` is the local supervisor that opens/closes the box and manages live agents.
- Pithos is the durable state system for tasks, runs, artifacts, and task graph history.
- Spawner renders prompts and launches harness sessions.
- Pandora is the long-lived HITL agent.
- Envy, Toil, Greed, and War are the other built-in agents.
- Harnesses are the underlying runtimes such as Claude Code or Pi.

## Config ownership

- `<data-dir>/` is pdx-owned runtime state plus bundled canonical config reference.
  `pdx init` and `pdx open` overwrite `<data-dir>/agents.toml`, `<data-dir>/templates/`, and `<data-dir>/AGENTS.md`.
- `<user-data-dir>/` is user-owned config.
  `pdx` scaffolds `<user-data-dir>/AGENTS.md`, `<user-data-dir>/CLAUDE.md`, `<user-data-dir>/agents.toml`, and `<user-data-dir>/artifacts.toml` once and re-seeds this `PANDORA.md` reference on `init` / `open`.

Defaults and related env vars:

- `PDX_DATA_DIR` sets `<data-dir>`; default is `~/.pdx`
- `PDX_USER_DATA_DIR` sets `<user-data-dir>`; default is `<data-dir>/config`
- `PITHOS_DB` points at the Pithos SQLite DB used by CLIs and agents

## Prompt defaults

Bundled Agent prompts are intentionally light on workflow preference. They teach Agents the Pithos basics: claim work, inspect the graph/task, respect scopes and fencing tokens, enqueue durable follow-up work, then complete or fail the held task.

The installed source of truth for bundled prompts is `<data-dir>/templates/`, selected by `<data-dir>/agents.toml`:

- Pandora: `<data-dir>/templates/agents/pandora.md`
- Envy: `<data-dir>/templates/agents/envy.md`
- Toil: `<data-dir>/templates/agents/toil.md`
- Greed: `<data-dir>/templates/agents/greed.md`
- War: `<data-dir>/templates/agents/war.md`
- Common fragments: `<data-dir>/templates/common/base.md`, `<data-dir>/templates/common/afk.md`, and `<data-dir>/templates/common/hitl.md`

When an agent helps edit any context file that a particular Agent will read, it must first study that Agent's installed bundled template and configured common fragments. For example, before changing Greed policy packs, Greed-targeted `agents.toml` settings, or other Greed-facing context in `<user-data-dir>`, read `<data-dir>/agents.toml`, `<data-dir>/templates/agents/greed.md`, and the common fragments listed for Greed. Build user policy on top of those files instead of duplicating or contradicting them.

They do not own your habits for artifacts, review cadence, fan-out shape, handoff format, Git flow, intake routing, or project-specific release rules. Put those preferences in user-owned policy packs.

The CLI and Pithos authorization remain the enforcement layer for invalid commands, unsupported capabilities, stale tokens, and malformed graph operations.

## Artifact Contracts

`artifacts.toml` is a user-owned Artifact Contract file. `pdx init` and `pdx open` scaffold it with commented examples only and do not overwrite your edits.

When `PDX_USER_DATA_DIR` is set, Pithos reads active entries from `<user-data-dir>/artifacts.toml` at Artifact Contract use sites. If the file is missing or contains only comments, no artifact rules apply. Direct Pithos invocations with `PDX_USER_DATA_DIR` unset intentionally run without Artifact Contracts.

Active entries use `[[artifacts]]` tables:

```toml
[[artifacts]]
capability = "clarify"
kind = "open_questions"
required = true
title = "Open questions"
body = "List material questions requiring user intent, or write: No open questions."
```

`required = true` gates completion for matching tasks until at least one active artifact with the configured `kind` exists on the task. `title` and `body` are guidance only; empty artifact bodies still satisfy required kinds.

Useful commands:

```sh
pithos task artifact add <task-id> [--run <run-id>] --token <token> --kind <kind> --title <title> [--stdin]
pithos task artifact reject <artifact-id> [--run <run-id>] --token <token> --reason <reason>
pithos task artifact list <task-id> [--json]
pithos task artifact show <artifact-id> [--json]
pithos task inspect <task-id> [--full]
```

Primary task and graph views show active artifacts only. Rejected artifacts remain available through `task artifact list/show`. Spawner renders applicable rules into Agent prompts; invalid present `artifacts.toml` fails preview/launch rendering loudly.

## Policy packs

Policy packs are Markdown files appended after the bundled prompt and generated command reference. Use them for workflow preference, not for replacing the Pithos operating contract.

Example layout:

```text
<user-data-dir>/
  agents.toml
  policies/
    git-flow.md
    perkbox.md
    projects/docs-release.md
```

Declare policies in `agents.toml`:

```toml
[policies.git-flow]
files = ["policies/git-flow.md"]

[policies.perkbox]
files = ["policies/perkbox.md"]

[policies.docs-release]
files = ["policies/projects/docs-release.md"]
```

`files` is a non-empty ordered array. Use multiple entries when one policy pack is
split across shared and project-specific Markdown files; they are appended in
array order. Missing files fail preview/launch rendering by default. Add
`allow_empty = true` only for intentionally optional packs: all missing files
contribute no content, all present files load normally, and mixed present/missing
files still fail loudly.

Select policies with `add` and `remove`:

```toml
[policy]
add = ["git-flow"]

[agents.toil.policy]
add = ["perkbox"]

[[rules]]
path = "~/work/app/docs/docs-shared"
agents.toil.policy.remove = ["git-flow"]
agents.toil.policy.add = ["docs-release"]
```

Good policy pack examples:

- "Always create a design artifact before asking for sign-off."
- "For this repo, enqueue review after production-code execution tasks."
- "For CI failure intake, route directly to triage unless the failure mentions credentials."
- "War should summarize changed files and validation commands in its final task-facing summary."

## Match rules

Rules apply in file order when all predicates match the Agent launch context.

Supported predicates:

- `path` — exact launch path match; supports `~`
- `path_glob` — path glob; supports `~`
- `scope_kind` — `global`, `repo`, or `worktree`
- `agent` — one built-in Agent kind

Examples:

```toml
[[rules]]
path_glob = "~/work/**"
policy.add = ["perkbox"]

[[rules]]
scope_kind = "worktree"
agent = "war"
agents.war.policy.add = ["worktree-execution"]

[[rules]]
path_glob = "~/work/**"
agents.war.harness.kind = "claude"
agents.greed.harness.kind = "claude"

[[rules]]
path_glob = "~/dev/**"
agents.war.harness.kind = "pi"
agents.greed.harness.kind = "pi"
```

A final rendered prompt may contain a policy id only once. Adding an already-selected policy or removing an absent policy fails loudly.

## Harness settings

Harness config is separate from prompt policy. Bundled config keeps the Agent templates but does **not** choose a Harness runtime for you. `pdx open` fails until the launch it needs has user Harness config, starting with Pandora.

### All-Pi example

```toml
[agents.pandora.harness]
kind = "pi"
model = "deepseek-v4-pro"
system_prompt_mode = "replace"
tools.add = ["bash", "read"]

[agents.toil.harness]
kind = "pi"
model = "openai-codex/gpt-5.4"
system_prompt_mode = "append"
tools.add = ["bash", "read", "grep", "find", "ls", "subagent"]

[agents.greed.harness]
kind = "pi"
model = "openai-codex/gpt-5.5"
system_prompt_mode = "replace"

[agents.war.harness]
kind = "pi"
model = "openai-codex/gpt-5.4"
system_prompt_mode = "append"

[agents.envy.harness]
kind = "pi"
model = "openai-codex/gpt-5.4"
system_prompt_mode = "append"
```

### Custom skills

Custom skills are scoped per Agent by adding that Agent's skill location to its Harness argv. Put the argv entry only under the Agent that should see those skills; this gives, for example, Greed-only design/review skills without contaminating Pandora, War, Toil, or Envy.

For Pi, point `--skill` at a folder containing skill folders:

```toml
[agents.greed.harness]
kind = "pi"
model = "openai-codex/gpt-5.5"
system_prompt_mode = "replace"
argv.add = ["--skill", "$PDX_USER_DATA_DIR/greed-skills"]
```

For Claude, expose the same kind of skills through a plugin dir and enable the `Skill` tool:

```toml
[agents.pandora.harness]
kind = "claude"
model = "sonnet"
system_prompt_mode = "replace"
tools.add = ["Skill"]
argv.add = ["--plugin-dir", "$PDX_USER_DATA_DIR/claude-pandora"]
```

Example layout:

```text
<user-data-dir>/
  greed-skills/                  # Pi: --skill "$PDX_USER_DATA_DIR/greed-skills"
    design/
      SKILL.md                   # skill file on design
      reference.md               # optional details on design
    review/
      SKILL.md
  claude-pandora/                # Claude: --plugin-dir "$PDX_USER_DATA_DIR/claude-pandora"
    skills/
      sitrep/
        SKILL.md
      pandora-smoke/
        SKILL.md
```

### All-Claude example

This mirrors a real config shape with Claude skills exposed to Pandora through a plugin directory under `<user-data-dir>`.

```toml
[agents.pandora.harness]
kind = "claude"
model = "sonnet"
system_prompt_mode = "replace"
tools.add = ["Bash", "Read", "Skill"]
argv.add = ["--name", "Pandora", "--effort", "high", "--plugin-dir", "$PDX_USER_DATA_DIR/claude-pandora"]

[agents.toil.harness]
kind = "claude"
model = "sonnet"
system_prompt_mode = "append"
argv.add = ["--effort", "high", "--name", "Toil"]

[agents.greed.harness]
kind = "claude"
model = "opus"
system_prompt_mode = "append"
tools.add = ["Agent", "Bash", "Glob", "Grep", "Read", "Skill"]
argv.add = ["--effort", "high", "--name", "Greed"]

[agents.war.harness]
kind = "claude"
model = "sonnet"
system_prompt_mode = "append"
argv.add = ["--effort", "high", "--name", "War"]

[agents.envy.harness]
kind = "claude"
model = "sonnet"
system_prompt_mode = "append"
argv.add = ["--effort", "high", "--name", "Envy"]
```

For the custom skills example above, `$PDX_USER_DATA_DIR/claude-pandora/skills/sitrep/SKILL.md` can contain a short “Sitrep” instruction, while `pandora-smoke` can encode your local smoke-test runbook and `tidyup` can encode your end-of-day cleanup routine.

### Mixed/path-targeted example

```toml
[agents.pandora.harness]
kind = "claude"
model = "sonnet"
system_prompt_mode = "replace"
tools.add = ["Bash", "Read", "Skill"]
argv.add = ["--name", "Pandora", "--plugin-dir", "$PDX_USER_DATA_DIR/claude-pandora"]

[agents.war.harness]
kind = "pi"
model = "openai-codex/gpt-5.4"
system_prompt_mode = "append"

[[rules]]
path_glob = "~/work/**"
agents.war.harness.kind = "claude"
agents.war.harness.model = "sonnet"
agents.war.harness.argv.add = ["--effort", "high", "--name", "War"]

[[rules]]
path_glob = "~/dev/**"
agents.war.harness.kind = "pi"
agents.war.harness.model = "openai-codex/gpt-5.4"
```

Required scalar fields for a launched Agent are `kind`, `model`, and `system_prompt_mode`. Top-level Agent Harness config is applied first, then matching rules are applied in file order, so narrower path rules can replace earlier scalar values for the actual launch:

- `agents.<kind>.harness.kind`
- `agents.<kind>.harness.model`
- `agents.<kind>.harness.system_prompt_mode`
- `rules.agents.<kind>.harness.kind`
- `rules.agents.<kind>.harness.model`
- `rules.agents.<kind>.harness.system_prompt_mode`

List fields use operations:

- `agents.<kind>.harness.tools.add`
- `agents.<kind>.harness.tools.remove`
- `agents.<kind>.harness.argv.add`
- `agents.<kind>.harness.argv.replace`
- `rules.agents.<kind>.harness.tools.add`
- `rules.agents.<kind>.harness.tools.remove`
- `rules.agents.<kind>.harness.argv.add`
- `rules.agents.<kind>.harness.argv.replace`

Use `argv.replace` when a narrower rule must discard earlier Harness-specific flags, such as swapping Claude-only argv for a Pi launch. `harness.argv` is an argv array, not a shell string. Supported expansion is terse and path-oriented only:

- `$PDX_DATA_DIR` / `${PDX_DATA_DIR}`
- `$PDX_USER_DATA_DIR` / `${PDX_USER_DATA_DIR}`
- `~` / `~/...`

Other `$VARS` fail render; no shell eval, globbing, or quote parsing.

## External intake socket

External watchers feed signals to Envy by writing events to the daemon-owned intake socket. There is no `agents.toml` producer configuration and pdx does not supervise your watcher process.

While `pdx open` is running, the socket is available at:

```text
<data-dir>/intake.sock
```

With the default data dir, that is `~/.pdx/intake.sock`. `pdx daemon status` also reports the resolved `intake_socket` path.

Write one JSON object to the socket connection:

```json
{ "title": "New bug report", "body": "Full signal text for Envy to classify." }
```

Required fields:

- `title` — non-empty string used as the intake Task title
- `body` — non-empty string used as the intake Task body

For each valid event, pdx creates a global `intake` Task. Envy claims that Task and classifies the signal. Put workflow-specific classification rules in Envy policy packs.

Example producer:

```sh
printf '%s\n' '{"title":"New bug report","body":"Full signal text for Envy to classify."}' | nc -U ~/.pdx/intake.sock
```

Because the producer is outside pdx, run it however you prefer: launchd, systemd, cron, a repo script, a GitHub/email watcher, or a one-off shell command. Malformed JSON, missing fields, or enqueue failures return an error response on the socket and do not create a Task.

## Validation

Validate rendering with `pandora-spawn preview`:

```sh
pandora-spawn preview \
  --agent war \
  --mode afk \
  --scope scope_repo_preview \
  --scope-kind repo \
  --scope-path "$PWD" \
  --run run_preview \
  --session-id 123e4567-e89b-12d3-a456-426614174000 \
  --cwd "$PWD"
```

Preview shows the final Harness config, matched rules, selected policy ids, policy file paths, and rendered prompt.

## Reset behavior

- `pdx init` / `pdx open` re-seed bundle-owned canonical config and this reference file
- `pdx init` / `pdx open` scaffold missing user-owned `agents.toml`, `artifacts.toml`, and pointer files once
- `--clean` wipes runtime state only: DB, runs, logs, socket
- `--nuke` wipes pdx-owned runtime/bundled state while preserving `<user-data-dir>`, then re-seeds canonicals

Prefer editing user-owned `agents.toml`, `artifacts.toml`, and user-owned `policies/` files instead of editing bundle-owned reference material.
