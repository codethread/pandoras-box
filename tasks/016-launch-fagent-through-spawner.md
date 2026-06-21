# Task 16: Launch fagent through Spawner

## Scope

Type: AFK

Wire the fake Harness into the existing Spawner render/launch path so tests can select `fagent` from user-owned `agents.toml` and launch it using repo-local paths, without making `fagent` a production default or requiring global installation.

## Must implement exactly

- Extend Spawner Harness kind validation/rendering to accept `fagent` in addition to existing real Harness kinds.
- Build `fagent` argv from the existing manifest fields and Spawner-managed prompt/startup inputs, preserving the same cwd/env/run correlation behavior used for other Harnesses.
- Support both Spawner modes needed by existing Agent kinds: AFK process launch and HITL tmux launch. The HITL command must start successfully under tmux and remain alive until killed/closed unless its configured script fails loudly.
- Allow tests to pass the repo-local built `fagent` path through `harness.argv`; do not assume `fagent` is on PATH.
- Keep session log/transcript behavior minimal: either mark `fagent` transcript unsupported with a loud error or emit a simple log path that is not used by the MVP tests.
- Add focused Spawner tests showing `fagent` can be selected via user config, rendered with expected argv/env, and launched with fake launch services.
- Update Spawner README/config notes to identify `fagent` as a test Harness only.

## Done when

- `pnpm --filter @pdx/spawner test` passes.
- Spawner preview/render tests prove user config can select `fagent` using repo-local argv for both AFK and Pandora HITL modes.
- Existing Claude/Pi render and transcript tests still pass.

## Out of scope

- Full pdx/tmux/Podman integration tests.
- Implementing `fagent` task workflow scripts.
- Adding `fagent` as a default in bundled `resources/data-dir/agents.toml`.

## References

- `specs/harness-contract.md`
- `specs/agent-configuration.md`
- `packages/spawner/README.md`
- `packages/spawner/src/manifest.ts`
- `packages/spawner/src/spawner.ts`
