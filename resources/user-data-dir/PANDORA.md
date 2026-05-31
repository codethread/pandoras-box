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
  `pdx` scaffolds `<user-data-dir>/AGENTS.md`, `<user-data-dir>/CLAUDE.md`, and `<user-data-dir>/agents.toml` once and re-seeds this `PANDORA.md` reference on `init` / `open`.

Defaults and related env vars:

- `PDX_DATA_DIR` sets `<data-dir>`; default is `~/.pdx`
- `PDX_USER_DATA_DIR` sets `<user-data-dir>`; default is `<data-dir>/config`
- `PITHOS_DB` points at the Pithos SQLite DB used by CLIs and agents

## Prompt defaults

Bundled Agent prompts are intentionally light on workflow preference. They teach Agents the Pithos basics: claim work, inspect the graph/task, respect scopes and fencing tokens, enqueue durable follow-up work, then complete or fail the held task.

They do not own your habits for artifacts, review cadence, fan-out shape, handoff format, Git flow, intake routing, or project-specific release rules. Put those preferences in user-owned policy packs.

The CLI and Pithos authorization remain the enforcement layer for invalid commands, unsupported capabilities, stale tokens, and malformed graph operations.

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
file = "policies/git-flow.md"

[policies.perkbox]
file = "policies/perkbox.md"

[policies.docs-release]
file = "policies/projects/docs-release.md"
```

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

Useful Pandora Claude skills are ordinary Claude plugin skills. For example, `$PDX_USER_DATA_DIR/claude-pandora/skills/sitrep/SKILL.md` can contain a short “Sitrep” instruction, while `pandora-smoke` can encode your local smoke-test runbook and `tidyup` can encode your end-of-day cleanup routine.

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

Required scalar fields for a launched Agent are `kind`, `model`, and `system_prompt_mode`. Matching rule values can target the actual Harness controls for launches under specific paths:

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
- `rules.agents.<kind>.harness.tools.add`
- `rules.agents.<kind>.harness.tools.remove`
- `rules.agents.<kind>.harness.argv.add`

`harness.argv` is an argv array, not a shell string. Supported expansion is terse and path-oriented only:

- `$PDX_DATA_DIR` / `${PDX_DATA_DIR}`
- `$PDX_USER_DATA_DIR` / `${PDX_USER_DATA_DIR}`
- `~` / `~/...`

Other `$VARS` fail render; no shell eval, globbing, or quote parsing.

## Hooks

Input hooks let an external watcher feed signals to Envy. Configure them in `<user-data-dir>/agents.toml`:

```toml
[hooks.input]
command = ["/path/to/watcher", "--flag"]
```

`command` is an argv array. It is not run through a shell, so include the executable and each argument as separate strings. To disable a configured hook:

```toml
[hooks.input]
enabled = false
```

Do not set `enabled = false` together with `command`.

The input hook runs as a long-lived producer after Pandora is live. pdx closes hook stdin, reads hook stdout as newline-delimited JSON, and writes hook stderr to `<data-dir>/runs/hook.stderr.log`.

Each stdout line must be one JSON object:

```json
{ "title": "New bug report", "body": "Full signal text for Envy to classify." }
```

Required fields:

- `title` — non-empty string used as the intake Task title
- `body` — non-empty string used as the intake Task body

For each valid line, pdx creates a global `intake` Task. Envy claims that Task and classifies the signal. Put workflow-specific classification rules in Envy policy packs.

Invalid JSON or invalid fields are logged and skipped; the hook keeps running. If the hook exits, pdx restarts it with backoff. Repeated crashes create an `input_hook_stuck` Repair Alert for Pandora and stop restarts. After fixing the hook script, use `pdx hook restart` to resume supervision without a full pdx restart, or `pdx hook stop` to disable it. A full `pdx close && pdx open` also clears the crash-loop state.

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
- `--clean` wipes runtime state only: DB, runs, logs, socket
- `--nuke` wipes pdx-owned runtime/bundled state while preserving `<user-data-dir>`, then re-seeds canonicals

Prefer editing user-owned `agents.toml` and user-owned `policies/` files instead of editing bundle-owned reference material.
