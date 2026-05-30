## Shared Pithos operating rules

### Durable state

- Pithos is durable truth for tasks, runs, claims, artifacts when present, events, and graph repair.
- Pithos stores the full task graph; agents usually work the task chain reconstructed from it.
- A task chain is the inspectable history the user will review later: typed task edges, supersessions, artifacts when present, runs, and events together explain what happened.

### Claims and fencing

- Claim work with the rendered claim command before inspecting task body.
- A run may hold at most one task at a time.
- `PITHOS_RUN_ID`, `PITHOS_SCOPE_ID`, and `PITHOS_DB` are set in the environment.
- Keep the task id and fencing token returned by claim; use that token when completing or failing held work.

### Scopes and queues

- Use your launch `scope_id` for normal same-scope follow-up work. Escalation tasks for Pandora must use global scope: `--scope global --capability escalate`.
- Scopes partition work queues. Use `pithos scope list` to discover existing scopes and `pithos scope upsert --kind repo|worktree --path <path>` to create or reactivate a scope before enqueueing work there.
- Global scope is for escalations or genuinely cross-project/unknown routing. Repo and worktree scopes are for project-local work; execution tasks must target one of those filesystem-backed scopes.
- Creating or reactivating a repo/worktree scope records the path in Pithos; if the target directory does not exist yet, create it first with filesystem commands, then upsert the scope and use the returned scope id.

### Graph shape

- Typed edges are `after` (direct prerequisite), `gate` (wait for a target branch to drain), `about` (immediate Pandora context), and `repair` (system-authored broken-work alert).
- Escalation is a normal global-scope task claimed by Pandora.
- Review is a requested HITL assessment task claimed by Greed. It is not an automatic post-design or post-execution task.
- When enqueueing requested review work, choose the narrowest useful scope: worktree for pre-merge implementation review and local smoke evidence; repo for repo-local work not tied to one checkout; global only for cross-repo or multi-scope review.
- A global review task body must name the relevant scopes, repos, worktrees, upstream task ids, desired focus, any existing artifact ids, and any smoke-test or command evidence Greed should inspect.

### Payloads and artifacts

- For any Pithos command using `--stdin`, send exactly one stdin document; prefer quoted heredocs (`<<'EOF'`) and do not stage temp files solely for payload upload.
- Inspect and reference existing artifacts when they matter.
- Create new artifacts when the task asks for one or when important evidence needed for later review would otherwise not be inspectable from the task body, transcript, repo, or command output.
- Do not create artifacts as a default completion step.

## Common command recipes

### Inspect the held task

After claiming, inspect the held task:

```sh
pithos graph inspect --task <task-id>
pithos task inspect <task-id>
```

Use `graph inspect --task` for the big picture: chain topology, previews, artifact refs, gates, supersessions, and other task ids to drill into. `task inspect` renders a single-task Markdown dossier by default: the full task body, full bodies of artifacts attached to that task, and direct local context only.

### Complete or fail

Complete with default `{}` metadata:

```sh
pithos task complete --run $PITHOS_RUN_ID --token <token> <task-id>
```

Fail with a reason:

```sh
pithos task fail --run $PITHOS_RUN_ID --token <token> --reason '<reason>' <task-id>
```

### Enqueue follow-up work

Enqueue with default auto chaining:

```sh
pithos task enqueue --run $PITHOS_RUN_ID --scope $PITHOS_SCOPE_ID --capability <capability-from-your-enqueues> --title '<title>' --stdin <<'EOF'
<task body>
EOF
```

Enqueue with `--chain none` (manual edges):

```sh
pithos task enqueue --run $PITHOS_RUN_ID --scope $PITHOS_SCOPE_ID --capability <capability-from-your-enqueues> --title '<title>' --stdin --chain none [--after <task-id>] [--gate-on <task-id>] <<'EOF'
<task body>
EOF
```

Enqueue an escalation for Pandora while you still hold the current task:

```sh
pithos task enqueue --run $PITHOS_RUN_ID --scope global --capability escalate --title '<title>' --stdin <<'EOF'
<what the user/Pandora needs to know>
EOF
```
