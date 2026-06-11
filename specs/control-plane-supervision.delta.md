# Delta: Control Plane Supervision for Artifact Contracts

**Status:** Planned Delta
**Last Updated:** 2026-06-11
**Target Spec:** `specs/control-plane-supervision.md`
**Primary Spec:** `specs/artifact-contracts.md`

## Purpose

Update the Control Plane Supervision spec only where Artifact Contracts affect pdx lifecycle, user config scaffolding, launch environment, and built-in Capabilities.

## Required changes

### Built-in Agents and Capabilities

Update the capabilities table:

- Add `clarify` to built-in Capabilities.
- Envy claims `intake` and `clarify`.
- Envy may enqueue `clarify`, `triage`, `design`, and `escalate`.
- No other Agent claims `clarify` in MVP.
- Clarify is a requirements-measurement lane for interpretive input; deterministic external intake remains unchanged unless Envy explicitly routes interpretive work into `clarify`.

The durable intent is: Envy owns clarify production, Toil remains triage owner, and Pithos authorization remains source of truth.

### `pdx init` / `pdx open`

Add user config scaffolding behavior:

- `pdx init` and `pdx open` create `$PDX_USER_DATA_DIR/artifacts.toml` only when missing.
- The scaffold contains commented recommended examples only; no active artifact requirements are bundled.
- Existing user `artifacts.toml` is never overwritten.
- `PANDORA.md` should document Artifact Contracts alongside other user config references.

### Launch environment

Clarify:

- pdx-launched Agents receive `PDX_USER_DATA_DIR` so Pithos can read user-owned Artifact Contracts during Agent calls.
- Pithos owns parsing and enforcing `artifacts.toml`; pdx does not validate completion requirements in reconcile.
- If `PDX_USER_DATA_DIR` is unset for a direct Pithos invocation, Artifact Contracts are disabled by design.
- If `PDX_USER_DATA_DIR` is set but the directory is unreadable or cannot be inspected, Pithos fails loudly.

### Non-goals / boundary

Add or preserve boundaries:

- pdx does not own artifact completion enforcement.
- pdx does not maintain a bundled active artifact contract.
- pdx does not retroactively revalidate Tasks when user config changes.
- Spawner prompt rendering includes artifact guidance through the shared Pithos parser/normalizer, but completion enforcement remains Pithos-owned.

### Code locations

Add expected references:

- `packages/pdx/src/live.ts` — scaffold missing user `artifacts.toml`
- `resources/user-data-dir/artifacts.toml` — commented example scaffold
- `resources/user-data-dir/PANDORA.md` — Artifact Contract guide
- `packages/pithos/src/*` — parsing/enforcement owner
