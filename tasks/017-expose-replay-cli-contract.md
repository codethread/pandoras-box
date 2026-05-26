# Task 17: Expose replay CLI contract

## Scope

Type: AFK

Expose the Engine replay transition through the public Pithos CLI so Pandora can run the durable repair operation from her held Repair Alert context.

## Must implement exactly

- Add `pithos task replay <target-task-id> --token <repair-alert-token> --reason <text> [--run <run-id>]`.
- Support `PITHOS_RUN_ID` as the default actor run exactly like existing mutating Task commands, including conflict validation when both env and `--run` are present.
- Return JSON by default with the replayed target Task status and completed Repair Alert status.
- Add generated Pithos CLI help/help-json metadata for the new command.
- Ensure validation failures surface as tagged JSON errors consistent with existing CLI behavior.
- Keep stdin out of this command; replay reason is a required option, not a payload document.

## Done when

- CLI tests cover successful replay from a real isolated SQLite DB.
- CLI tests cover env run id resolution, conflicting run id failure, missing/empty reason, stale token, and mismatched Repair Alert failures.
- Pithos CLI help and help-json tests include `pithos task replay`.
- Pithos CLI tests and typecheck pass.

## Out of scope

- Do not add a pdx wrapper command.
- Do not alter non-Pandora command authorization.
- Do not update Spawner command-card filtering or Pandora prompt guidance; those belong to the next task.

## References

- `specs/task-replay.md`
- `packages/pithos/src/cli.ts`
- `packages/pithos/test/cli.test.ts`
