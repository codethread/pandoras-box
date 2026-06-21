# Task 19: Test pdx open fagent flow

## Scope

Type: AFK

Create the first real Podman-backed integration test that opens the box with `fagent`, drives the MVP task chain through real Pithos, Spawner, pdx, AFK processes, and tmux-backed Pandora, then closes the box and asserts cleanup.

## Must implement exactly

- Add a separate integration test entrypoint distinct from fast unit tests, but included by root `pnpm verify` after unit tests.
- Resolve the clean-checkout build ordering explicitly: either change root `pnpm verify` so the workspace build runs before the Podman integration command, or make the Podman integration command perform the required workspace build before launching `pdx`.
- In the Podman integration environment, build/use repo-local `pithos`, `pdx`, `pandora-spawn`, and `fagent` bins without global linking.
- Seed isolated user config so every Agent kind needed by the MVP selects `fagent` and points at the repo-local fagent config.
- Run the minimal flow:
  - `pdx init`;
  - seed a repo-scoped `triage` task or equivalent initial work needed for the chain;
  - `pdx open` starts the daemon and Pandora tmux sessions;
  - Toil claims triage and enqueues execute;
  - War claims execute and fails once;
  - Pandora claims the Repair Alert and repairs/replays;
  - War claims execute again and completes;
  - `pdx close` cleans up.
- Assert on the minimal stable surface:
  - tmux sessions `pdx--daemon` and `pdx--pandora` exist while open;
  - Pithos task graph reaches the expected terminal state;
  - the configured fagent JSONL event log includes the key workflow milestones;
  - pdx-owned tmux sessions are gone after close.
- Use deterministic polling around observable state only where unavoidable; avoid arbitrary sleeps as synchronization.

## Done when

- The integration command passes in Podman on a clean checkout with `pnpm install` available.
- Fast unit tests remain runnable separately.
- Root `pnpm verify` includes the integration command and works from a clean checkout without relying on pre-existing bin files.
- Failures leave enough logs/artifacts in the isolated data dir for an agent to inspect.

## Out of scope

- Comprehensive transcript rendering for `fagent`.
- Testing every Agent kind or every Repair Alert kind.
- Host-machine tmux tests outside Podman.

## References

- `specs/control-plane-supervision.md`
- `specs/harness-contract.md`
- `packages/pdx/README.md`
- `packages/spawner/README.md`
- `packages/fagent/README.md`
