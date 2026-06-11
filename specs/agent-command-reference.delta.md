# Delta: Agent Command Reference Rendering for Artifact Contracts

**Status:** Planned Delta
**Last Updated:** 2026-06-11
**Target Spec:** `specs/agent-command-reference.md`
**Primary Spec:** `specs/artifact-contracts.md`

## Purpose

Update generated command references so Agents see the changed artifact and inspect command contracts sourced from CLI metadata and stable annotations.

## Required changes

### Rendered command cards

Update Pithos command cards for all roles that receive `pithos task` commands.

Affected commands:

```text
pithos task artifact add <task-id> [--run <run-id>] --token <token> --kind <kind> --title <title> [--stdin]
pithos task artifact list <task-id> [--json]
pithos task artifact show <artifact-id> [--json]
pithos task artifact reject <artifact-id> [--run <run-id>] --token <token> --reason <reason>
pithos task inspect <task-id> [--json] [--full]
```

### Notes / annotations

Add or update annotations:

- Artifact `kind` must be lower snake case.
- `artifact add` requires the current task fencing token and can only mutate the held Task.
- `artifact reject` retires a mistaken active artifact from current task/graph views and required-artifact satisfaction; it does not delete history.
- `artifact list` shows active and rejected artifact metadata but not bodies.
- `artifact show` is the exact-id body/detail command.
- `task inspect` default shows compact active artifact refs only.
- `task inspect --full` renders active artifact bodies inline.
- `task inspect --json` already returns structured data; `--full --json` is invalid.

### Artifact contract prompt block

The generated command reference remains Markdown, but Spawner also appends a generated Artifact Contract section adjacent to the command reference when applicable. This is not a user-editable template variable and does not change `agents.toml` template-variable ownership.

The target spec should document:

- the generated section uses a short preamble plus minified normalized JSON
- no-applicable rules render no Artifact Contract section
- Spawner obtains the parsed/normalized contract through the public `@pdx/pithos` parser/normalizer, so prompt rendering and Pithos completion enforcement share validation logic
- present-but-invalid `artifacts.toml` fails render/open loudly when `PDX_USER_DATA_DIR` is set and the file exists

### Role filters

No new role-filter category is needed. Existing role filters already expose `pithos task` to Envy, Toil, Greed, War, and Pandora. The new artifact subcommands will appear under those existing filters.
