# Task 21: Add fagent HITL input loop

## Scope

Type: AFK

Make `fagent` usable as a real long-lived Pandora-style HITL Harness by processing later operator/test input inside the same process that `pdx open` launched, instead of requiring tests to replace the tmux pane command.

## Must implement exactly

- Extend `fagent` HITL mode so a config can mark the startup response as resident and then process subsequent newline-delimited stdin inputs in the same running process.
- Keep the existing Spawner-launched HITL shape: the process starts from `--print begin`, writes a ready marker, and remains alive until killed by `pdx close` or a loud script failure.
- Allow configured stdin inputs such as `repair` to run the same scripted Pithos actions already used by `fagent` scripts, using the original process environment (`PITHOS_RUN_ID`, `PITHOS_SCOPE_ID`, `PITHOS_DB`, etc.).
- Add an explicit process-continuity evidence surface to the configured JSONL event log: record a stable fagent instance id and process id at HITL startup, and include the same instance id/process id on later stdin-triggered action events.
- Preserve deterministic failure behavior: malformed config, missing script, failed Pithos command, or failed configured action writes a clear stderr error and exits non-zero so pdx can observe the broken Harness.
- Keep AFK behavior unchanged: AFK `--print` scripts still run once and exit.
- Add focused `@pdx/fagent` tests that spawn the CLI, observe the ready marker, write a `repair` line to stdin, and assert the configured JSONL event log records the repair action without starting a second fagent process.

## Done when

- `pnpm --filter @pdx/fagent test` passes.
- Existing response, READ, AFK workflow, and HITL residency tests still pass.
- A package test proves at least one post-startup stdin command runs in the original fagent process by asserting the HITL startup event and the stdin-triggered action event share the same instance id/process id in the configured event log.

## Out of scope

- Changing Spawner's tmux wrapper unless required to keep the original fagent process alive correctly.
- Updating the Podman `pdx open` integration script.
- Implementing a general REPL language, prompts, history, or multi-agent chat semantics.

## References

- `packages/fagent/README.md`
- `packages/fagent/src/main.ts`
- `packages/fagent/src/index.ts`
- `packages/fagent/test/fagent.test.ts`
- `packages/spawner/src/spawner.ts`
