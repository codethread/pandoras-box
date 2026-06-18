# Task 13: Enforce repo trunk launch guard

## Scope

Type: AFK

Wire the configured supervisor launch policy into the non-Pandora launch path. When `enforce_repo_root_trunk` is enabled and a queued repo-scoped task is ready to launch from a repo that is not on its remote default branch, pdx must route the task through the existing launch-precondition Repair Alert path before any Agent Run is created.

## Must implement exactly

- Load the parsed supervisor launch config into the pdx daemon/supervisor path used by reconcile.
- In the selected ready-task launch flow, after confirming the repo Scope path exists and before `renderAgent` / Run creation, apply the repo default-branch probe only when:
  - the setting is enabled, and
  - the selected Task Scope kind is `repo`.
- Treat these probe outcomes as launch-precondition failures for repo Scopes:
  - not a Git repository,
  - unknown remote default branch,
  - detached HEAD,
  - current branch differs from the remote default branch.
- Reuse the existing atomic Pithos launch-precondition transition so pdx does not create a Run, the queued Task is cancelled, and a global `launch_precondition` Repair Alert is created for Pandora.
- Include structured evidence in the Repair Alert body: Task, Scope, Scope path, resolved Git root when known, current branch when known, expected default branch when known, and the specific reason.
- The branch-guard Repair Alert wording must explicitly tell Pandora that after the repo is switched back to the default branch, Task Replay is the preferred repair when the original Task remains valid; supersession/replanning/intentional abandon remain alternatives.
- Keep `global` and `worktree` Scopes exempt from this guard.
- Preserve the existing missing-cwd launch-precondition behavior.
- Add tests that prove the guard prevents render/run/launch for a repo violation and that disabled config or exempt scope kinds do not invoke the repo probe.

## Done when

- With the setting enabled, each negative repo probe outcome — non-Git path, unknown default branch, detached HEAD, and non-default current branch — is covered at the reconcile boundary and cancels through `escalateLaunchPrecondition` with no Spawner render or Pithos Run creation.
- The Repair Alert evidence distinguishes branch mismatch, detached HEAD, unknown default branch, non-Git path, and missing cwd.
- Branch-guard Repair Alert text mentions replay after correcting the branch precondition.
- With the setting disabled, existing repo launch behavior is unchanged.
- Worktree-scoped ready tasks are not checked by the repo-root trunk guard.
- Focused pdx reconcile/spawn tests pass.

## Out of scope

- Do not change Pithos Repair Alert kinds; use the existing `launch_precondition` kind.
- Do not mark the original queued Task as failed.
- Do not auto-switch branches, fetch, or repair repository state.
- Do not require Spawner or Agent prompt changes for enforcement.

## References

- `specs/control-plane-supervision.md` — launch-precondition and planned repo guard contract.
- `packages/pdx` — reconcile, launch preconditions, and supervisor policy boundary.
- `packages/pithos` — existing launch-precondition Repair Alert transition.
- `packages/spawner` — must remain launcher/prompt-only; enforcement should happen before Spawner launch.
