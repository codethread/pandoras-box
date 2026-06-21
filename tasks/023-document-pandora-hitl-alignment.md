# Task 23: Document Pandora HITL alignment

## Scope

Type: AFK

Update documentation and task notes after the fagent integration proves Repair Alert handling through the original pdx-launched Pandora HITL session.

## Must implement exactly

- Update fagent documentation to describe resident HITL stdin command handling, including the ready marker, line-oriented configured inputs, loud failure behavior, and JSONL event evidence.
- Update integration-test documentation to state that the `pdx open` fagent flow must not replace Pandora's tmux pane for repair; it drives the original pdx-launched session.
- Revisit every documentation surface updated for Task 20 that describes the Podman Pandora flow, including `packages/pdx/README.md` and any relevant spec text, and keep it aligned with the no-respawn rule.
- Adjust any stale wording that implies fagent HITL merely runs once and idles without processing input.
- Append a Developer Note summarizing the alignment fix and validation commands run.

## Done when

- Relevant READMEs accurately describe the implemented HITL repair flow.
- `pnpm verify` passes or the same validation caveat from Task 22 is recorded if Podman is unavailable.
- A future agent can understand from docs alone that `tmux respawn-pane` is not an acceptable shortcut for the MVP repair path.

## Out of scope

- New behavior or test coverage.
- General user-facing promotion of fagent as a production Harness.

## References

- `README.md`
- `packages/fagent/README.md`
- `packages/pdx/README.md`
- `packages/spawner/README.md`
- `specs/control-plane-supervision.md`
- `specs/harness-contract.md`
- `tasks/README.md`
