# Task 18: Add Podman tmux test container

## Scope

Type: AFK

Add the container support needed to run real tmux integration tests under Podman with isolated runtime directories, without depending on the developer's host tmux server or globally linked Harness binaries.

## Must implement exactly

- Add a minimal Containerfile for integration tests with Node/pnpm, tmux, and the OS packages required by the existing workspace build/test stack.
- Add repo scripts to build and run the integration container with Podman.
- Run tests against the current working tree in the simplest maintainable way: prefer mounting the repo into the container unless local filesystem constraints force copying.
- Ensure each integration run sets isolated `PDX_DATA_DIR`, `PDX_USER_DATA_DIR`, `PITHOS_DB`, and `TMUX_TMPDIR` inside the container.
- Keep Podman as the supported container runtime for this test path; do not add Docker-specific scripts.
- Add a tiny smoke command inside the container that proves tmux can create/list/kill a session under the isolated `TMUX_TMPDIR`.

## Done when

- A developer can run one documented pnpm script that builds the Podman image and executes the tmux smoke test.
- The smoke test does not create or touch host tmux sessions.
- The root README or a relevant package README documents the Podman integration-test command.

## Out of scope

- Full `pdx open` workflow assertions.
- fagent workflow scripting changes.
- Cross-platform Docker support.

## References

- `AGENTS.md`
- `README.md`
- `specs/control-plane-supervision.md`
- `packages/pdx/README.md`
