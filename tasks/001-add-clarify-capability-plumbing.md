# Task 1: Add clarify capability plumbing

## Scope

Type: AFK

Add the planned `clarify` Capability to the durable built-in authorization surface and make it available anywhere the existing capability set is parsed, seeded, displayed, or rendered for agents.

## Must implement exactly

- Add `clarify` to the built-in Pithos Capability set.
- Update seeded claim authorization so Envy can claim `intake` and `clarify`.
- Update seeded enqueue authorization so Envy can enqueue `clarify`, `triage`, `design`, and `escalate`.
- Keep `clarify` claim authorization limited to Envy in this change; if current repository specs already disagree, note the contradiction in `tasks/README.md` Developer Notes instead of expanding scope.
- Update capability parsing/choices used by task enqueue, task claim, task supersede, chain policy, help JSON, and tests.
- Update bundled/user-facing agent prompt resources only where they list capabilities or describe Envy's role, keeping deterministic external intake separate from clarify.

## Done when

- Fresh Pithos init seeds `clarify` as a Capability and the intended Envy claim/enqueue rules.
- CLI/help JSON accepts `clarify` anywhere other capabilities are valid.
- Existing capability tests are updated or new tests prove Envy can claim `clarify` and unauthorized Agents cannot.
- `pnpm --filter @pdx/pithos test` passes.

## Out of scope

- Artifact Contract parsing or enforcement.
- Brief artifact semantics or signed/auto status.
- Any path/scope-specific routing policy for clarify beyond built-in authorization.

## References

- `specs/artifact-contracts.md` section 9.
- `specs/control-plane-supervision.delta.md`.
- `packages/pithos/src/builtins.ts`.
- `packages/pithos/src/chain-policy.ts`.
- `packages/pithos/src/cli.ts`.
- `resources/data-dir/templates/agents/envy.md`.
