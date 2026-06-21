# Task 22: Drive Pandora repair without respawn

## Scope

Type: AFK

Fix the Podman-backed `pdx open` integration so the Repair Alert is handled by the original Pandora tmux session launched by pdx/Spawner, not by manually respawning the pane with a different command.

## Must implement exactly

- Remove the `tmux respawn-pane` shortcut from the `pdx open` fagent integration path.
- Configure Pandora's initial fagent config before `pdx open` so the pdx-launched Pandora process can both become ready on startup and process a later repair input in the same session.
- After War's first deterministic failure creates the Repair Alert, send the repair input to the existing `pdx--pandora` tmux session using the normal tmux input path; do not replace the pane command or start a second Pandora fagent process.
- Assert from the fagent JSONL event log that the Pandora repair/replay events come from the same fagent instance id/process id as the original HITL startup event for the live Pandora run that pdx created for `pdx open`.
- Assert tmux process continuity across the repair input: the `pdx--pandora` pane pid observed before sending repair input remains the same after the repair event is recorded. Pane id alone is not sufficient because `tmux respawn-pane` can preserve pane identity while replacing the process.
- Keep existing assertions for tmux sessions while open, final Pithos task statuses, fagent milestones, and `pdx close` cleanup.
- Preserve failure artifacts so a failing run still exposes pdx logs, fagent events, tmux capture, and final graph output when available.

## Done when

- `pnpm run test:integration:pdx-open-fagent` passes under Podman.
- The integration script contains no `tmux respawn-pane` or equivalent pane-command replacement for Pandora repair, and its assertions would fail if repair ran in a replacement fagent process with the same Pithos run id.
- The event sequence still proves triage -> execute first failure -> Pandora replay -> execute completion.
- `pnpm verify` passes or, if Podman is unavailable in the runner, all non-container checks pass and the integration command is documented as the only skipped validation.

## Out of scope

- Expanding the integration to Greed, Envy, or additional Repair Alert kinds.
- Adding transcript rendering support for fagent.
- Reworking pdx supervision policy beyond what is needed to drive input to the existing tmux session.

## References

- `scripts/podman-integration-pdx-open-fagent.sh`
- `packages/fagent/README.md`
- `packages/spawner/README.md`
- `specs/control-plane-supervision.md`
- `specs/harness-contract.md`
