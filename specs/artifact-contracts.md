# Artifact Contracts

**Status:** Implemented
**Last Updated:** 2026-06-11

## 1. Overview

### Purpose

Artifact Contracts define the user-owned rules that tell Agents what evidence shapes a Task may produce and which evidence is required before a held Task can complete. The system keeps artifacts generic Markdown-bearing records, but makes their presence reliable through fenced artifact mutation, completion-time checks, and focused inspection APIs.

### Goals

- Let users define artifact expectations in `$PDX_USER_DATA_DIR/artifacts.toml` without DB-specific brief schemas.
- Render relevant artifact guidance into Agent prompts as normalized minified JSON.
- Enforce required artifact presence at `task complete` when a user Artifact Contract is configured.
- Require active task ownership and fencing tokens for artifact add/reject mutations.
- Preserve artifact audit history while allowing mistaken WIP artifacts to be retired from primary views.
- Keep graph and task inspection concise by default, with body/detail APIs available on demand.
- Support the `clarify` requirements-measurement lane without introducing a first-class Brief table.

### Non-Goals

- No artifact body schema validation, JSON Schema, Markdown parsing, or content matching.
- No count constraints beyond required presence of at least one active artifact by kind.
- No bundled active artifact requirements.
- No path-, scope-, or agent-specific artifact rule matching in MVP.
- No retroactive revalidation of completed Tasks after config changes.
- No hard deletion of artifacts and no artifact reactivation flow.
- No first-class Brief table/status model in this stage.

## 2. Design Decisions

- **Decision:** Artifact Contracts live in user-owned `$PDX_USER_DATA_DIR/artifacts.toml`, separate from `agents.toml`.
  - **Rationale:** `agents.toml` configures Spawner render/launch behavior. Artifact Contracts affect Pithos Task transitions and should be parsed by Pithos at the boundary where they are enforced.

- **Decision:** `pdx init` / `pdx open` scaffold `artifacts.toml` once with commented examples only.
  - **Rationale:** Users own their pipeline. The bundle can recommend shapes without silently enabling completion gates or overwriting local workflow policy.

- **Decision:** If `PDX_USER_DATA_DIR` is unset, Pithos disables Artifact Contracts for that invocation.
  - **Rationale:** Artifact Contracts are explicitly user-owned and have no default lookup path. This is an intentional direct-CLI mode rather than a durable DB invariant; pdx-launched Agents must receive `PDX_USER_DATA_DIR` so normal boxed operation uses the configured contract.

- **Decision:** Present-but-invalid `artifacts.toml` fails loudly.
  - **Rationale:** Silent config drift would make completion enforcement unpredictable. Unknown fields, unknown capabilities, duplicate rules, bad kinds, or malformed TOML should be traceable operator errors.

- **Decision:** Rules are a flat `[[artifacts]]` list scoped only by Capability.
  - **Rationale:** Capability is the durable work contract. A flat list is easy to validate and avoids duplicating Spawner's path/rule machinery before a concrete need exists.

- **Decision:** `required` defaults to `false`.
  - **Rationale:** The file is both prompt guidance and completion policy. Optional artifact shapes are useful to Agents; only explicit `required = true` changes Task completion behavior.

- **Decision:** Artifact kinds are lower snake case everywhere.
  - **Rationale:** Required-artifact matching depends on exact `kind` values. Lower snake case keeps command usage, grep, and prompt examples stable without introducing a DB enum.

- **Decision:** Completion enforcement checks active artifact presence only, and empty artifact bodies still count.
  - **Rationale:** The immediate alignment problem is missing durable artifact steps, not malformed Markdown or empty bodies. Agents generally follow guidance; semantic validation can be added only if observed failures justify it.

- **Decision:** Artifact add/reject require active held-task ownership and a valid fencing token.
  - **Rationale:** Artifacts can satisfy completion gates. Only the current task owner should be able to mutate the current evidence set.

- **Decision:** Mistaken artifacts are rejected, not deleted.
  - **Rationale:** Rejection removes artifacts from current evidence views and required-artifact satisfaction while preserving audit history and exact-id access.

- **Decision:** Primary views show active artifacts only.
  - **Rationale:** `task inspect` and `graph inspect` should describe current task state, not every historical artifact mutation. The targeted artifact APIs own audit/detail access.

## 3. Configuration Contract

`artifacts.toml` is optional and is read only from `$PDX_USER_DATA_DIR/artifacts.toml`.

If `PDX_USER_DATA_DIR` is unset, no artifact rules apply. If `PDX_USER_DATA_DIR` is set but the directory is unreadable or cannot be inspected, Pithos fails loudly. If the directory exists but has no `artifacts.toml`, no artifact rules apply. If the file exists, Pithos parses and validates it at use sites that need the contract.

### Rule shape

```toml
[[artifacts]]
capability = "clarify"
kind = "open_questions"
required = true
title = "Open questions"
body = """
List material questions requiring user intent, or write:

No open questions.
"""
```

Fields:

| Field        | Required | Meaning                                                                 |
| ------------ | -------- | ----------------------------------------------------------------------- |
| `capability` | yes      | Built-in Pithos Capability this artifact rule applies to.               |
| `kind`       | yes      | Lower-snake-case artifact kind.                                         |
| `required`   | no       | Defaults to `false`; when `true`, gates Task completion by kind.        |
| `title`      | yes      | Non-empty guidance title; not matched against produced artifact titles. |
| `body`       | yes      | Non-empty Markdown guidance; not parsed or matched during enforcement.  |

Validation:

- unknown top-level fields fail
- unknown rule fields fail
- unknown capabilities fail
- `kind` must match `^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$`
- `title` and `body` must be non-empty
- duplicate `(capability, kind)` rules fail, regardless of `required`

## 4. Prompt Rendering Contract

Pithos exports the Artifact Contract parser, normalized types, and capability-filtering helper through its public package boundary. Spawner uses that shared parser during prompt rendering so prompts and completion enforcement interpret `artifacts.toml` the same way without duplicating TOML validation logic.

Spawner injects relevant rules into Agent prompts as a generated section adjacent to the generated command reference, not as a user-editable template variable. This keeps `agents.toml` and Agent template-variable configuration separate from Artifact Contracts.

Selection:

- If the selected/current Capability is known, include only rules for that Capability.
- Otherwise include rules for all Capabilities the Agent kind may claim.
- Include required and optional rules.
- Emit defaulted `required: false` explicitly.

Prompt preamble:

```md
Applicable artifact contracts follow as normalized JSON. `required: true` blocks task completion until an active artifact with that `kind` exists on the task. `title` and `body` are guidance only.
```

Example payload:

```json
{
	"artifacts": [
		{
			"capability": "clarify",
			"kind": "open_questions",
			"required": true,
			"title": "Open questions",
			"body": "List material questions requiring user intent, or write:\n\nNo open questions."
		}
	]
}
```

Pithos remains the enforcement owner. Prompt rendering is advisory except that it reports the same parsed contract Agents will encounter at completion time when the same environment is used. Because enforcement reads the current file at completion time, an operator changing `artifacts.toml` while a Task is held can change what completion requires; an Agent that hits a missing-artifact error should treat the error as the refreshed contract and attach the named artifacts before retrying completion.

## 5. Completion Enforcement

`pithos task complete <task-id> --token <token> [--run <run-id>] [--stdin]` checks the current Artifact Contract during the completion transaction.

For the Task's Capability:

- rules with `required = false` do not gate completion
- each `required = true` rule is satisfied by at least one active artifact on the Task with the same `kind`
- rejected artifacts do not satisfy requirements
- artifact title, body, body emptiness, and number of matching artifacts are not validated

Missing required artifacts fail with a tagged `VALIDATION_ERROR` naming the Task Capability and each missing `kind` plus guidance `title`.

Completed Tasks are never re-opened or reclassified when `artifacts.toml` changes later. The current config only affects future completion attempts.

## 6. Artifact Lifecycle

Artifacts have status:

```text
active | rejected
```

New artifacts start `active`. Rejection is a one-way transition from `active` to `rejected`; there is no reactivation command in MVP.

Database intent:

```sql
ALTER TABLE artifacts ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE artifacts ADD COLUMN rejected_at TEXT;
ALTER TABLE artifacts ADD COLUMN rejected_by_run_id TEXT REFERENCES runs(id);
ALTER TABLE artifacts ADD COLUMN rejection_reason TEXT;
```

The implemented schema should enforce valid status values and the consistency of rejection metadata. Rejected artifacts keep their body and original authorship metadata.

Artifact mutations require active held-task ownership:

- parent Task status is `claimed` or `running`
- Run is live and holds the parent Task
- supplied fencing token matches the Task
- `--run` / `PITHOS_RUN_ID` resolution follows existing Pithos rules

`artifact add` and `artifact reject` both emit events:

- `task.artifact_added`
- `task.artifact_rejected`

Rejecting an already rejected artifact fails loudly.

## 7. CLI Surface

### Mutation commands

```text
pithos task artifact add <task-id> [--run <run-id>] --token <token> --kind <kind> --title <title> [--stdin]
pithos task artifact reject <artifact-id> [--run <run-id>] --token <token> --reason <reason>
```

`artifact add` keeps optional body semantics: if `--stdin` is omitted, body is `""`.

Mutation commands return JSON only. `add` and `reject` return compact artifact metadata without body:

```json
{
	"ok": true,
	"artifact": {
		"id": "artifact_abc",
		"task_id": "task_123",
		"run_id": "run_envy",
		"kind": "open_questions",
		"title": "Open questions",
		"status": "active",
		"created_at": "..."
	}
}
```

Rejected metadata includes `rejected_at`, `rejected_by_run_id`, and `rejection_reason`.

### Inspection commands

```text
pithos task artifact list <task-id> [--json]
pithos task artifact show <artifact-id> [--json]
```

`artifact list` is a targeted audit/detail surface. It includes active and rejected artifacts, but not bodies.

Default list output:

```text
- artifact_abc [open_questions] Open questions
- artifact_def [open_questions] Old questions [rejected: wrong artifact]
```

`artifact list --json` returns the same metadata array under `{ "ok": true, "artifacts": [...] }`.

`artifact show <artifact-id>` shows active or rejected artifacts by exact id. Default output uses a Markdown heading, a pretty-printed fenced JSON metadata block, and a fenced Markdown body:

````md
# artifact_abc [open_questions] Open questions

```json
{
	"id": "artifact_abc",
	"task_id": "task_123",
	"run_id": "run_envy",
	"kind": "open_questions",
	"title": "Open questions",
	"status": "rejected",
	"created_at": "...",
	"rejected_at": "...",
	"rejected_by_run_id": "run_envy",
	"rejection_reason": "wrong artifact"
}
```

```md
body
```
````

`artifact show --json` returns metadata plus `body`.

## 8. Inspection and Graph Behavior

### `task inspect`

```text
pithos task inspect <task-id> [--json] [--full]
```

Default Markdown shows active artifact refs only:

```md
Artifacts:

- artifact_abc [open_questions] Open questions
```

`--full` renders active artifact bodies inline using the existing concise embedded artifact format.

`--json` returns the structured Task inspect object and includes active artifacts only. `--full --json` is invalid because `--full` affects Markdown rendering only.

Rejected artifacts are available through `task artifact list` and `task artifact show`, not through the primary Task inspect view.

### `graph inspect`

Readable graph output omits `artifacts: none`. It renders an artifact block only when a node has active artifact refs.

`graph inspect --json` also excludes rejected artifacts from node `artifact_refs`.

For Tasks in `claimed` or `running` status whose Capability has required artifact rules, graph JSON includes compact live requirement status:

```json
"requirement_status": { "missing_required": ["assertions"] }
```

If all required artifacts are present, include an empty array for claimed/running Tasks with active requirements:

```json
"requirement_status": { "missing_required": [] }
```

Do not include this field for non-claimed Tasks or Capabilities with no required rules. Human graph output should only surface missing required artifacts for claimed/running Tasks, not optional rules or satisfied requirements.

## 9. Clarify Capability Integration

Artifact Contracts are the persistence mechanism for the `clarify` requirements-measurement lane.

Implemented capability behavior:

- `clarify` is a built-in Capability
- Envy may claim `intake` and `clarify`
- Envy may enqueue `clarify`, `triage`, `design`, and `escalate`
- interpretive intake may enqueue `clarify`
- `clarify` work normally enqueues `triage` and may enqueue escalation as needed
- deterministic external intake remains unchanged unless Envy routes interpretive work into clarify by policy

Artifact Contracts can express the expected clarify outputs without hard-coding a Brief schema:

```toml
[[artifacts]]
capability = "clarify"
kind = "open_questions"
required = true
title = "Open questions"
body = "List material questions requiring user intent, or write: No open questions."

[[artifacts]]
capability = "clarify"
kind = "assertions"
required = true
title = "Assertions"
body = "List contested assertions with binary acceptance criteria."

[[artifacts]]
capability = "clarify"
kind = "assumptions"
required = true
title = "Assumptions"
body = "List non-escalated defaults chosen for non-material ambiguity."
```

The stronger invariant that `design` and `execute` require a signed/auto brief in branch closure is deferred until the system has observed whether presence-enforced clarify artifacts are sufficient. This spec deliberately avoids a first-class Brief table in MVP.

## 10. Code Locations

Implementation areas:

| Path                                            | Responsibility                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/pithos/src/db.ts`                     | Artifact status/rejection schema migration.                                                  |
| `packages/pithos/src/rows.ts`                   | Artifact row parsing and status validation.                                                  |
| `packages/pithos/src/artifact-contracts.ts`     | Resolve and parse `$PDX_USER_DATA_DIR/artifacts.toml`; export parser/normalizer for Spawner. |
| `packages/pithos/src/engine/claim-loop.ts`      | Fenced artifact add/reject and completion enforcement.                                       |
| `packages/pithos/src/engine/task-read-model.ts` | Active artifact refs, list/show read models, and live missing-required status.               |
| `packages/pithos/src/engine/render.ts`          | Compact/full inspect, graph artifact rendering, artifact list/show renderers.                |
| `packages/pithos/src/cli.ts`                    | CLI flags and command dispatch.                                                              |
| `packages/spawner/src/spawner.ts`               | Prompt injection of normalized artifact contract JSON.                                       |
| `packages/pdx/src/live.ts`                      | Scaffold user `artifacts.toml` once.                                                         |
| `resources/user-data-dir/artifacts.toml`        | Commented example scaffold.                                                                  |
| `resources/user-data-dir/PANDORA.md`            | Installed user-facing artifact-contract guidance.                                            |

## 11. Testing

Automated coverage should include:

- artifact config parser validation and disabled-env behavior
- lower-snake-case artifact kind validation
- fenced `artifact add` / `artifact reject` ownership checks
- completion failure when required active artifact kinds are missing
- rejected artifacts not satisfying requirements
- artifact list/show text and JSON output
- compact vs full task inspect rendering
- graph omission of empty artifact blocks and rejected artifacts
- graph live missing-required status for claimed/running Tasks only
- prompt rendering of minified normalized JSON for selected/current Capability

Manual smoke validation should use isolated `PDX_DATA_DIR`, `PDX_USER_DATA_DIR`, `PITHOS_DB`, and `TMUX_TMPDIR` as described in `AGENTS.md`.

## 12. Open Questions

None for MVP.
