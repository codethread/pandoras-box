# Task 17: Script fagent task workflow

## Scope

Type: AFK

Extend `fagent` from simple response mode into a deterministic Pandora's Box workflow driver that can claim and mutate real Pithos tasks for the MVP chain: Pandora escalates/reroutes, Toil triages, War fails once, Pandora repairs, and War completes on replay.

## Must implement exactly

- Add JSON-configured role/run behavior keyed by the environment Spawner already provides, such as `PITHOS_RUN_ID`, `PITHOS_SCOPE_ID`, cwd, and startup message.
- Implement Pandora-compatible HITL behavior: when launched in HITL mode, `fagent` accepts the startup input, performs configured scripted actions when applicable, and remains alive waiting for input until `pdx close` or process termination.
- Implement the minimal scripted actions needed by the MVP using the repo-local `pithos` binary path supplied in config:
  - claim a task for the run;
  - enqueue an `execute` task from a `triage` task;
  - fail the first `execute` attempt to create a Repair Alert;
  - let Pandora claim the Repair Alert and replay or otherwise repair the failed task using the existing Pithos contract;
  - complete the replayed `execute` task.
- Keep scripts deterministic and fail loudly when an expected claim/task/action is unavailable.
- Define and implement a stable evidence surface for integration tests: a configured append-only JSONL event log path, typically under the isolated data dir, with one event per key scripted action and fields for run id, agent kind when known, action, task id when applicable, and outcome.
- Stdout/stderr may remain useful for humans, but integration tests must be able to assert milestones from the configured fagent JSONL event log rather than incidental terminal capture.
- Add package-level tests using an isolated real SQLite Pithos DB and repo-local `pithos` dev/build entrypoint where appropriate.

## Done when

- A focused `@pdx/fagent` test can seed Pithos state, run the configured fagent scripts as subprocesses, and observe the expected task statuses/Repair Alert progression.
- Existing exact response and `READ` behavior from Task 15 still works.
- The workflow config remains simple JSON and is documented in the fagent README, including the JSONL event log contract.
- A focused test proves Pandora-style HITL mode stays resident after its scripted action rather than exiting like an AFK worker.

## Out of scope

- tmux assertions.
- `pdx open`/`pdx close` orchestration.
- General-purpose scripting languages, sleeps, or nondeterministic polling.
- Supporting real Claude/Pi transcripts.

## References

- `specs/task-graph.md`
- `specs/control-plane-supervision.md`
- `packages/pithos/README.md`
- `packages/fagent/README.md`
