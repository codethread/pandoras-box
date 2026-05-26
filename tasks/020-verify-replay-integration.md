# Task 20: Verify replay integration

## Scope

Type: AFK

Run the focused and full verification needed to prove Task Replay works across Pithos Engine, CLI, generated agent prompts, and canonical docs.

## Must implement exactly

- Run focused Pithos tests for lifecycle, CLI, render, foundation, and chain-policy areas touched by replay and claim sequence.
- Run Spawner tests that render Pandora command cards/prompts.
- Run the repository standard verification suite.
- Perform an isolated SQLite CLI smoke that initializes a fresh DB, creates a replayable Repair Alert scenario, runs `pithos task replay`, and verifies the target is queued while the Repair Alert is done.
- Use a deterministic smoke outline unless implementation tests already provide an equivalent script:
  - set `PITHOS_DB` to a temp SQLite path
  - `pithos init --fresh`
  - create/upsert any needed repo/worktree scope in a temp directory
  - create live runs for the target claimant and Pandora
  - enqueue, claim, and fail or otherwise terminalize a target Task so Pithos creates a Repair Alert with a `repair` edge
  - have Pandora claim the Repair Alert and capture its fencing token from claim JSON
  - run `pithos task replay <target-task-id> --run <pandora-run-id> --token <token> --reason <text>`
  - inspect/assert the target is `queued` with reset attempts and the Repair Alert is `done`
- Record the verification commands and outcomes in `tasks/README.md` Developer Notes.
- Fix any failures caused by replay work; do not mark verification complete with known broken checks.

## Done when

- `pnpm verify` passes.
- Focused Pithos and Spawner test commands pass.
- Manual isolated CLI smoke passes without touching real `~/.pdx` or project DB state.
- Developer Notes record what was verified and any important caveats.

## Out of scope

- Do not add new feature behavior beyond fixes required to satisfy the spec.
- Do not perform live `pdx open` smoke unless needed; if used, follow the isolated tmux/data-dir rules in `AGENTS.md`.

## References

- `AGENTS.md`
- `specs/task-graph.md`
- `specs/control-plane-supervision.md`
- `specs/task-replay.md` if retained as a superseded change spec
- `packages/pithos/test/task-lifecycle.test.ts`
- `packages/pithos/test/cli.test.ts`
- `packages/spawner/src/spawner.test.ts`
- `tasks/README.md`
