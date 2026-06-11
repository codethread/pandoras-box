# Delta: Pithos Task Graph for Artifact Contracts

**Status:** Planned Delta
**Last Updated:** 2026-06-11
**Target Spec:** `specs/task-graph.md`
**Primary Spec:** `specs/artifact-contracts.md`

## Purpose

Update the Task Graph spec to reflect Artifact Contracts as the new artifact completion and inspection model, without duplicating the full artifact-contract design.

## Required changes

### Capabilities

- Add planned `clarify` Capability to the capability model.
- Clarify that `clarify` is claimed by Envy and is intended for requirements-measurement work between interpretive intake and triage.
- Keep deterministic external intake behavior separate from clarify unless routed there by explicit workflow policy.

### Payload CLI contract

Update the artifact add row:

```text
pithos task artifact add <task-id> [--run <run-id>] --token <token> --kind <kind> --title <title> [--stdin]
```

Notes to add:

- artifact body remains optional; omitted stdin means empty body
- `kind` must be lower snake case
- artifact add requires active held-task ownership and a matching fencing token

Add rows for:

```text
pithos task artifact reject <artifact-id> [--run <run-id>] --token <token> --reason <reason>
pithos task artifact list <task-id> [--json]
pithos task artifact show <artifact-id> [--json]
```

### Task completion

Add completion precondition:

- When `$PDX_USER_DATA_DIR/artifacts.toml` exists and contains `required = true` rules for the Task Capability, `task complete` requires at least one active artifact with each required `kind`.
- Rejected artifacts do not satisfy requirements.
- Completion enforcement checks presence only; it does not validate artifact title/body/content/count.
- Completed Tasks are not retroactively revalidated after config changes.

### Artifact model

Update Artifacts from append-only evidence rows to append-only evidence rows with current status:

```text
active | rejected
```

Add semantics:

- artifacts start active
- rejection is one-way and requires active held-task ownership plus fencing token
- rejected artifacts remain durable history but are hidden from primary task/graph views
- rejected artifacts are visible through `task artifact list` and exact-id `task artifact show`
- `task.artifact_rejected` event is emitted

### Inspection surfaces

Update `task inspect`:

```text
pithos task inspect <task-id> [--json] [--full]
```

Readable default:

- full task body remains visible
- attached artifacts render as compact active refs only: `artifact_id [kind] title`
- rejected artifacts are omitted

`--full`:

- renders active artifact bodies inline using the concise embedded artifact format

`--json`:

- returns the structured inspect object with active artifacts only
- `--full --json` is invalid

Update `graph inspect`:

- remove `artifacts: none` from readable graph output
- show artifact refs only when active artifacts exist
- omit rejected artifacts from text and JSON graph nodes
- for `claimed` / `running` Tasks with required artifact rules, include compact live missing-required status
- do not show missing-required status for queued, done, failed, cancelled, or dead-lettered Tasks

### Data model and code locations

Reference `specs/artifact-contracts.md` for the detailed artifact schema/config/API contract. The Task Graph spec should only summarize the relationship to Claims, completion, Artifacts, Events, and inspection surfaces.
