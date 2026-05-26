# Task 18: Teach Pandora replay workflow

## Scope

Type: AFK

Update Pandora-facing instructions and generated command references so Pandora knows when to use replay versus Supersession while handling Repair Alerts.

## Must implement exactly

- Update Pandora Repair Alert guidance to prefer `pithos task replay` when the Task definition is still valid and the failure was caused by execution context or external preconditions.
- Preserve Supersession guidance for cases where the Task body, assumptions, scope, or plan need to change.
- Explain that Pandora must claim the Repair Alert first and use the held alert fencing token when replaying the affected Task.
- Mention that replay completes the Repair Alert and resets the target Task to queued with a fresh retry budget.
- Ensure generated command-card filtering includes the new Pithos replay command for Pandora where command cards are rendered.
- Update prompt/render tests that assert command-card or Pandora-template content.

## Done when

- Pandora prompt text gives clear replay-vs-supersede guidance for `interrupt`, `task_failed`, `dead_letter`, and `launch_precondition` Repair Alerts.
- Spawner/Pandora prompt tests pass with the new command and guidance.
- The wording does not instruct War or other non-Pandora agents to replay their own work.

## Out of scope

- Do not implement more CLI or Engine behavior.
- Do not add automatic replay policy to pdx.
- Do not fold the change spec into canonical docs yet.

## References

- `specs/task-replay.md`
- `resources/data-dir/templates/agents/pandora.md`
- `resources/data-dir/templates/common/base.md`
- `packages/spawner/src/spawner.ts`
- `packages/spawner/src/spawner.test.ts`
