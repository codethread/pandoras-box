# Task 15: Add fagent read harness

## Scope

Type: AFK

Create a new bin-only workspace package for `fagent`, a fake Harness CLI for deterministic local and integration tests. The slice must prove the binary can read a simple repo-controlled JSON config, accept the same prompt/startup argv shape Spawner will pass later, emit configured responses, and perform the builtin `READ` command against the filesystem.

## Must implement exactly

- Add a private workspace package named `@pdx/fagent` with a `fagent` bin and the same build/start script conventions as existing bin packages.
- Do not globally link `fagent` or require it to be on PATH for tests.
- Implement the simplest JSON config needed for MVP:
  - exact input/response mappings such as `ping` -> `pong`;
  - a builtin `READ X,Y,Z` command that reads the named files and prints `READ_RESULT` followed by deterministic per-file sections containing the file path and contents.
- Support relative file reads from the process cwd. Absolute paths may work through Node, but do not add extra path-policy machinery for this slice.
- Fail loudly on malformed config, missing config path, missing response, or unreadable files with a non-zero exit and clear stderr.
- Add focused package tests for configured exact response, `READ`, and loud failure.

## Done when

- `pnpm --filter @pdx/fagent test` passes.
- `pnpm --filter @pdx/fagent build` creates an executable repo-local bin.
- The package is included by workspace build/typecheck/lint through normal pnpm workspace discovery.
- No production package depends on `@pdx/fagent` yet.

## Out of scope

- Spawner manifest support for selecting `fagent`.
- Pithos task claiming/enqueue/complete behavior.
- tmux, Podman, or pdx end-to-end tests.
- YAML config, regex matching, multi-turn conversation semantics, or transcript parsing.

## References

- `specs/harness-contract.md`
- `packages/spawner/README.md`
- `packages/pithos/scripts/build.mjs`
- `packages/spawner/src/spawner.test.ts`
