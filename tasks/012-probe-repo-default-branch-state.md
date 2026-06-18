# Task 12: Probe repo default branch state

## Scope

Type: AFK

Add the pdx-side repository probe needed by the planned launch guard. The probe must classify a repo Scope path without mutating Git state and return structured evidence that the supervisor can later place into a Repair Alert.

## Must implement exactly

- Add a pdx service boundary for repo launch checks rather than calling raw Node process APIs from controller logic.
- Implement a live Git-backed probe that, for a candidate repo path:
  - resolves the actual Git repository root,
  - detects whether the path is not inside a Git work tree,
  - detects the current checked-out branch,
  - detects the remote default branch from local `origin/HEAD` metadata only,
  - classifies detached HEAD and unknown default branch distinctly,
  - returns structured evidence for success or failure.
- If local `origin/HEAD` metadata is unavailable or unusable, classify the result as `unknown default branch`; do not contact the remote to discover it.
- The probe must not fetch, run networked Git commands, change branches, set remote HEAD, write Git config, or otherwise mutate repository state.
- Add deterministic tests for the probe using isolated temporary Git repositories and/or fake process services.
- Keep all process execution behind the pdx service boundary and return tagged pdx errors for unexpected subprocess failures.

## Done when

- The probe reports success for a repo whose current branch equals `origin`'s default branch.
- The probe reports a non-default-branch violation with current/default branch evidence.
- The probe reports detached HEAD, non-Git path, and unknown default-branch cases distinctly.
- Tests prove no mutation-oriented or networked Git command is required for the happy path.
- Focused pdx tests for the new probe pass.

## Out of scope

- Do not cancel Tasks or create Repair Alerts in this task.
- Do not wire the probe into `spawnReadyAgent` yet.
- Do not apply any checks to worktree Scopes.
- Do not add user-facing docs beyond comments needed to explain the service contract.

## References

- `specs/control-plane-supervision.md` — planned repo default-branch launch guard behavior.
- `packages/pdx` — pdx service and process-execution boundaries.
- `AGENTS.md` — project rule that runtime process IO belongs behind services.
