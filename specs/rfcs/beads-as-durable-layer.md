# RFC: Beads as Pandora's Durable Layer

**Status:** Draft
**Last Updated:** 2026-06-21
**Session ID:** `019ee8ab-ef0e-79e9-a0b5-39ebf4aec6bc`
**Host:** `ct-mini`

## 1. Overview

### Purpose

This RFC records whether Pandora's Box could replace its custom Pithos durable
state layer with [Beads](https://github.com/gastownhall/beads) (`bd`) as the
underlying durable work graph, while keeping Pandora's Box as the control plane
for agent spawning, supervision, claim policy, and workflow invariants.

The conclusion of the originating discussion was: **Beads is a plausible durable
issue/work graph substrate, but it is not a drop-in replacement for Pithos'
control-plane state machine.** A migration should treat Beads as the data plane
and keep pdx/Pandora as the authoritative policy layer for any invariants that
matter to supervised agent execution.

### Goals

- Capture the relevant Beads capabilities in Pandora's Box terminology.
- Identify which Pithos/Pandora API contracts can map directly to Beads.
- Identify which Pithos/Pandora invariants must remain in pdx or a wrapper CLI.
- Describe two viable integration postures: convention over raw `bd`, and an
  authoritative pdx wrapper over Beads.
- Preserve enough context for a future migration planning session to continue
  from the originating conversation.

### Non-Goals

- This RFC is not an implementation plan and does not sequence a migration.
- This RFC does not propose changes to Beads core.
- This RFC does not inventory Pandora's Box files or Beads internals file by
  file.
- This RFC does not decide that Pandora's Box will migrate; it records the
  option space and likely contracts.
- This RFC does not require reproducing every Pithos invariant in Beads itself.

## 2. Design Decisions

- **Decision:** Treat Beads as a durable graph substrate, not as Pandora's full
  control plane.
  - **Rationale:** Beads intentionally owns issue tracking primitives: issues,
    dependencies, labels, comments, metadata, assignment, ready-work queries,
    history, sync, and integrations. It explicitly avoids encoding
    orchestration-layer policy such as agent routing, model choice, retry
    policy, workflow semantics, and supervision. Pandora's Box depends on those
    orchestration semantics, so they should remain above Beads.

- **Decision:** If Pandora's graph invariants matter, agents should mutate work
  through a pdx wrapper rather than raw `bd`.
  - **Rationale:** Raw `bd` can create, update, close, and link beads without
    knowing pdx concepts such as branch closure, repair authorization, fencing,
    scope placement, or late-growth invalidation. A wrapper can inspect Beads,
    enforce pdx rules, and then write through Beads' CLI or Go API.

- **Decision:** Raw Beads remains valuable for read-only inspection even under a
  wrapper-authoritative design.
  - **Rationale:** `bd show`, `bd ready`, `bd blocked`, `bd graph`, `bd dep
tree`, and `bd history` are useful agent/operator inspection surfaces. The
    risk is primarily unconstrained mutation, not observation.

- **Decision:** Use top-level Beads metadata keys for pdx routing and control
  hints.
  - **Rationale:** Beads exposes metadata filtering for ready/list queries and
    recommends metadata as the extension point for orchestration-specific data.
    Top-level scalar keys are simple to filter with `--metadata-field` and easy
    to consume from the Go API.

- **Decision:** Use an epic/molecule root as the durable chain anchor whenever
  possible.
  - **Rationale:** Beads can inspect an epic/molecule as a work graph. If every
    dynamically added node is parented to the same root and carries a stable
    chain id, pdx can reconstruct the intended closure without treating every
    incidental related edge as branch membership.

- **Decision:** Model important artifacts as first-class beads only when they
  need graph identity.
  - **Rationale:** Many Pithos artifacts can be comments or task metadata. A
    separate artifact bead is appropriate when the artifact needs independent
    lifecycle, querying, supersession, acceptance/rejection state, or graph
    traversal.

- **Decision:** Do not rely on Beads events alone for correctness.
  - **Rationale:** Beads has events, Dolt history, and an append-only audit log,
    but readiness and closure should be derived from the current graph. Events
    and hooks can wake pdx, but pdx should reconcile from Beads state.

## 3. Beads Summary

Beads is a distributed graph issue tracker optimized for AI-supervised coding
workflows. It is exposed primarily as the `bd` CLI, with JSON output for agents,
and also exposes a minimal Go library API. Its storage backend is Dolt, a
version-controlled SQL database. Dolt gives Beads local SQL queries, native
history, cell-level merge, branching, backup, and push/pull sync.

The important Beads primitives for Pandora's Box are:

| Beads primitive    | Meaning for Pandora's Box                                                |
| ------------------ | ------------------------------------------------------------------------ |
| bead / issue       | A durable unit of work or context.                                       |
| epic               | A bead with children via `parent-child` dependencies.                    |
| molecule / mol     | An epic/work graph with workflow helper commands and template semantics. |
| proto / formula    | Reusable workflow template that can instantiate a molecule.              |
| wisp               | Ephemeral molecule/work graph for local or low-audit operational work.   |
| dependency         | Directed edge from blocked/follow-up bead to referenced bead.            |
| `bd ready`         | Query the runnable frontier: open work with no active blockers.          |
| `bd ready --claim` | Atomically claim the first ready bead matching filters.                  |
| metadata           | Arbitrary JSON extension point for orchestrators and integrations.       |
| comments           | Durable human/agent-readable context attached to a bead.                 |
| Dolt history       | Version history for Beads data.                                          |
| audit log          | Append-only interaction log for agent/tool/LLM records.                  |

Beads has graph creation and graph inspection surfaces:

- `bd create --graph <plan.json>` creates multiple beads and edges in one
  operation using symbolic keys.
- `bd graph <id>` visualizes the connected graph around a bead; for epics it
  shows children and their dependencies.
- `bd graph <id> --json` exposes graph data for machine use.
- `bd list --parent <epic-id> --json`, `bd ready --parent <epic-id> --json`,
  and `bd blocked --parent <epic-id> --json` inspect a work package by root.
- `bd dep list` and the Go API can be used to compute custom closures.

Beads' dependency vocabulary is broader and less opinionated than Pithos'
typed task edges. Blocking edge types affect readiness; non-blocking edge types
provide provenance and knowledge graph links.

| Beads edge type          | Typical use                                      |
| ------------------------ | ------------------------------------------------ |
| `blocks`                 | B cannot start until A closes.                   |
| `parent-child`           | Structural hierarchy under an epic/molecule.     |
| `conditional-blocks`     | Work that runs only on failure-style closure.    |
| `waits-for`              | Fan-in/fan-out gate over child work.             |
| `discovered-from`        | Work found while doing another bead.             |
| `caused-by`              | Repair/provenance link to cause.                 |
| `validates`              | Test, review, or artifact validates target work. |
| `related` / `relates-to` | Non-blocking context.                            |
| `supersedes`             | Version/replacement relation.                    |

## 4. Mapping Pithos Concepts to Beads

| Pithos/Pandora concept | Beads mapping                                           | Notes                                                                   |
| ---------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| Task                   | Issue/bead                                              | Direct mapping for work items.                                          |
| Task chain             | Epic/molecule root plus dependencies                    | Chain is reconstructed, not stored as a first-class object.             |
| Scope                  | Metadata and/or labels                                  | Beads does not natively enforce repo/worktree scope placement.          |
| Capability             | Metadata, labels, type, or assignee convention          | Claim authorization remains pdx policy unless wrapped.                  |
| `after` edge           | `blocks` dependency                                     | Same broad sequencing intent.                                           |
| `gate` edge            | Gate bead or `waits-for` dependency                     | Lacks Pithos branch-closure release snapshots.                          |
| `about` edge           | `related`, `relates-to`, `discovered-from`, or comments | Non-blocking context.                                                   |
| `repair` edge          | Repair bead with `caused-by`/`discovered-from` metadata | Repair authorization remains pdx policy.                                |
| Supersession           | `bd supersede` or wrapper-managed replacement           | Beads supersession is simpler than Pithos canonical replacement chains. |
| Task Replay            | Wrapper operation                                       | Beads has reopen/update/close; Pithos replay semantics must be layered. |
| Artifact               | Comment, metadata, or artifact bead                     | Choose based on whether the artifact needs identity/lifecycle.          |
| Run                    | Metadata or dedicated run bead                          | Beads has no native execution Run table.                                |
| Claim                  | `bd ready --claim` or `bd update --claim`               | No Pithos fencing token or held-task invariant unless wrapper adds it.  |
| Fencing token          | Wrapper metadata/invariant                              | Beads claims are lighter.                                               |
| Event history          | Beads events, Dolt history, audit log                   | Use for audit, not as graph invariant source.                           |
| Branch closure         | pdx-computed closure over Beads graph                   | Beads does not define an official Pithos-style closure.                 |

## 5. PDX Contracts and Beads Replication

### Durable source of truth

Pithos currently owns durable truth for tasks, runs, claims, edges, artifacts,
events, scopes, and graph invariants. Beads can replace the durable truth for
issues, dependencies, labels, comments, metadata, ready work, and history.

Beads should not be expected to replace live process supervision, tmux state,
Harness launch, or Registry state. Those remain pdx/Spawner responsibilities.

### Work graph and chain root

The most Beads-native chain anchor is an epic/molecule root. A pdx chain should
have:

- a root epic/molecule bead;
- all planned and late-growth work parented to that root;
- blocking dependencies for execution order;
- non-blocking provenance edges for review findings, repair context, and
  discoveries;
- top-level metadata keys that allow pdx to identify the chain even if graph
  traversal becomes ambiguous.

Suggested metadata keys:

| Key              | Example                 | Purpose                              |
| ---------------- | ----------------------- | ------------------------------------ |
| `pdx_chain_id`   | `pdx-chain-abc`         | Stable logical chain id.             |
| `pdx_root_id`    | `bd-a1b2`               | Root epic/molecule id.               |
| `pdx_capability` | `execute`               | Routing/claim category.              |
| `pdx_agent_kind` | `war`                   | Preferred or allowed agent kind.     |
| `pdx_scope_kind` | `repo`                  | Placement category.                  |
| `pdx_scope_path` | `/Users/ct/dev/project` | Runtime location.                    |
| `pdx_stage`      | `design`                | Human workflow role.                 |
| `pdx_run_id`     | `run_...`               | Current/last supervised run, if any. |
| `pdx_session_id` | Harness session id      | Transcript correlation.              |

### Readiness and spawning

Beads' `bd ready` is a strong fit for pdx's reconcile loop. pdx can poll ready
work filtered by metadata and scope, then spawn a suitable agent.

The safest spawn contract is:

1. pdx observes a ready bead that matches capability/scope filters.
2. pdx starts an agent with those same filters in its launch instruction.
3. the agent claims with `bd ready --claim --json` or a pdx wrapper command;
4. if no bead is claimable by the time the agent starts, it exits or idles
   according to pdx policy.

The claim should still happen inside the agent or wrapper, not be assumed from
pdx's earlier observation. This preserves race safety.

### Claims and fencing

Beads supports simple atomic claim behavior: set assignee and status to
`in_progress` for the selected ready bead. That is enough for many multi-agent
workflows, but weaker than Pithos' Run-held-task model.

If Pandora's Box needs Pithos-like guarantees, the wrapper should enforce:

- an agent run may hold at most one claimed bead;
- claim metadata records `pdx_run_id`, `pdx_agent_kind`, and a fencing token;
- completion/failure/artifact mutation validates the current token;
- stale agents cannot close or mutate a bead after interruption/reclaim;
- cleanup and interrupt semantics remain pdx-owned.

Without a wrapper, these rules are conventions and can be bypassed by raw
`bd update` or `bd close`.

### Scope and capability authorization

Beads can store scope/capability as metadata and filter ready work with those
keys. Beads does not natively enforce that only War claims `execute`, only Greed
claims `design`/`review`, or that `execute` must run in a valid repo/worktree.

A pdx wrapper can reproduce Pithos admission and claim authorization:

- validate scope metadata before creating a bead;
- reject impossible scope/capability combinations;
- filter claimable work by agent kind;
- validate runtime path preconditions before spawning;
- create repair/escalation beads when launch preconditions fail.

### Late graph growth

Late graph growth is central to Pandora's current model: design leads to build,
build leads to review, review discovers new design/build/review work, and the
chain expands dynamically.

Beads supports late graph growth naturally: create more beads and dependencies
under the same epic/molecule. Reusable late-growth subgraphs can be attached via
molecule bonding. Ad hoc late growth can be created with `bd create --graph` or
ordinary `bd create` plus `bd dep add`.

Recommended Beads shape for review-driven redesign:

```text
feature root
├── design
├── build      depends on design
├── review     depends on build
├── design-v2  discovered-from review
├── build-v2   depends on design-v2
└── review-v2  depends on build-v2
```

If final delivery should wait for the revised path, the final delivery bead
must depend on `review-v2`, or the wrapper must supersede/replan the downstream
work explicitly.

The key gap: Beads does not have Pithos' released-gate late-growth protection.
It will not automatically detect that adding new work under a previously
released branch invalidates active downstream work. If this invariant matters,
pdx must enforce it by computing closure and checking downstream state before
allowing graph mutation.

### Closure and graph inspection

Beads exposes graph inspection, but it does not define a Pithos branch closure.
There are several useful closures pdx can compute:

| Closure                     | Beads basis                       | Use                             |
| --------------------------- | --------------------------------- | ------------------------------- |
| Work-package closure        | descendants of root epic/molecule | Normal pdx chain membership.    |
| Dependency closure          | BFS over dependencies/dependents  | Debugging and causal traversal. |
| Pithos-style branch closure | pdx-selected edge kinds           | Late-growth and gate policy.    |

For predictable pdx behavior, work-package closure should be anchored by
`pdx_root_id`/`pdx_chain_id`, not inferred from all connected Beads edges. Raw
`bd graph <id>` may include useful related context that is not intended to be
branch membership.

### Gates and checkpoints

Beads gates are issue-level coordination primitives. They can wait on PR merge,
CI run success, timers, human approval, or cross-rig issue closure. Beads also
has `waits-for` dependencies for fan-in over children.

These can replace simple Pithos checkpoint use cases:

- review after implementation;
- deploy after CI;
- resume workflow after a PR merges;
- wait for all dynamic child work before aggregation.

They do not replace Pithos gate-release snapshots or late-growth invalidation.
Those remain wrapper policy if needed.

### Repair, replay, and supersession

Beads can model repair as ordinary durable work:

- create a repair bead under the same root;
- link it to the broken bead with `caused-by`, `discovered-from`, or a custom
  dependency type;
- block downstream work on the repair or replacement path;
- use `bd supersede` for replacement history when the old work definition is no
  longer valid.

Pithos Task Replay has stricter semantics: Pandora must hold the matching Repair
Alert, the token must match, the target must be failed/cancelled/dead-lettered,
and the same task definition is reset. Beads does not provide that as a native
operation. A pdx wrapper can implement a replay-like command by validating
metadata/status, reopening or updating the target bead, recording comments/audit
entries, and closing the repair bead.

### Artifacts

Pithos artifacts can map to three Beads representations:

| Representation | Use when                                                                                |
| -------------- | --------------------------------------------------------------------------------------- |
| Task metadata  | Small structured machine references: paths, hashes, run ids.                            |
| Task comments  | Human-readable execution summaries, review notes, handoffs.                             |
| Artifact bead  | Artifact needs identity, lifecycle, review, supersession, querying, or graph traversal. |

A first-class artifact bead should normally be parented to the same chain root
and linked to its source task with a non-blocking edge such as `validates`,
`caused-by`, or `discovered-from`. It may be closed immediately if the artifact
is evidence rather than work.

Required artifact contracts are not native Beads behavior. If Pandora's Box
needs completion gates such as "execute tasks must attach an implementation
summary and test evidence," pdx should enforce those before allowing completion.

### Runs and transcripts

Beads has no native Run concept equivalent to Pithos. pdx can represent runs in
one of three ways:

1. metadata on the claimed bead for current/last run correlation;
2. comments/audit records for completed run summaries;
3. dedicated run beads if runs need graph identity, querying, or lifecycle.

The lightest useful contract is likely metadata plus Beads audit entries:

- `pdx_run_id`
- `pdx_session_id`
- `pdx_harness_kind`
- transcript path or external reference
- completion/failure summary comment

If run lifecycle remains as important as it is in current Pithos, dedicated
wrapper-managed run state may still be needed outside Beads issue primitives.

### History and audit

Beads is stronger than Pithos in one important storage dimension: every write can
be recorded in Dolt history and synchronized through Dolt remotes. Beads also
has issue-level history, comments, events, and an append-only interaction audit
log.

Pandora's Box should distinguish:

- **graph invariants**, derived from current Beads state;
- **operator/audit history**, derived from Dolt history, comments, events, and
  audit records;
- **agent transcript history**, stored by the Harness/pdx and referenced from
  Beads metadata or comments.

## 6. Integration Postures

### Option A: Beads by convention

Agents use `bd` directly. pdx watches Beads, interprets metadata/dependencies,
and spawns agents.

```text
Agents ──bd──▶ Beads
              ▲
              │ poll/hooks/events
             pdx ──spawns──▶ Agents
```

Benefits:

- minimal migration surface;
- maximum compatibility with Beads tooling;
- humans and agents can use normal `bd` commands;
- easiest way to validate Beads as a durable graph substrate.

Risks:

- agents can mutate the graph in ways pdx would not have allowed;
- invariants become prompt guidance and repair checks rather than hard gates;
- conventions can drift;
- raw `bd close` or `bd dep add` can bypass pdx claim, artifact, or late-growth
  policy.

This posture fits experiments and low-risk workflows.

### Option B: PDX wrapper as authority

Agents use pdx commands for state-changing workflow operations. pdx validates
policy and writes to Beads through the CLI or Go API.

```text
Agents ──pdx task/graph/artifact──▶ pdx policy layer ──bd/Go API──▶ Beads
                                      │
                                      └──spawns/reconciles agents
```

Benefits:

- preserves Pithos-like invariants;
- centralizes capability/scope/claim/fencing policy;
- lets pdx define branch closure and late-growth safety;
- keeps Beads schema clean by storing pdx-specific data in metadata;
- allows raw Beads reads while controlling writes.

Risks:

- more code than direct Beads usage;
- wrapper contract must be maintained;
- some Beads workflows become indirect for agents;
- raw `bd` can still bypass policy unless forbidden by operational convention.

This posture best matches Pandora's current design.

### Recommended hybrid

Use raw Beads for read-only inspection and a pdx wrapper for workflow mutations.

Allowed directly:

- `bd show`
- `bd list`
- `bd ready` without claim
- `bd blocked`
- `bd graph`
- `bd dep tree`
- `bd history`
- comment/history inspection

Wrapped by pdx:

- claim;
- complete/fail/cancel;
- enqueue/grow graph;
- attach/reject artifact;
- replay/supersede/repair;
- close chain/checkpoint;
- mutate scope/capability metadata.

This keeps Beads useful as an ecosystem and preserves pdx as the workflow
authority.

## 7. API Surface for a PDX Wrapper

The wrapper should expose domain operations rather than generic Beads mutations.
The exact CLI names are future work, but the contract shape should be stable.

### Read operations

| Operation     | Contract                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| chain inspect | Return root, members, selected closure, ready frontier, blocked work, artifacts, and recent history. |
| task inspect  | Return bead details plus pdx metadata, run/session refs, artifacts, and local graph context.         |
| ready         | Return claimable beads for an agent kind/scope/capability.                                           |
| closure       | Return pdx-defined closure for a bead/root using selected edge semantics.                            |
| graph audit   | Detect invariant violations created by raw Beads changes or older wrapper versions.                  |

### Mutation operations

| Operation    | Contract                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------- |
| enqueue      | Create a bead with pdx metadata, parent/root, and allowed dependencies.                       |
| graph grow   | Atomically add a planned or ad hoc subgraph under a root after validating late-growth policy. |
| claim        | Atomically claim a ready bead for a run and write fencing metadata.                           |
| complete     | Validate claim/fencing/artifact requirements, close bead, and record result metadata/comment. |
| fail         | Mark work failed according to pdx policy and create repair/escalation work if required.       |
| repair       | Create or resolve repair work with causal provenance.                                         |
| replay       | Reset/reopen same-definition work only under pdx authorization.                               |
| supersede    | Replace a bead or subgraph while preserving provenance and downstream safety.                 |
| artifact add | Attach metadata/comment/artifact bead according to artifact kind.                             |
| cancel       | Intentionally abandon non-held work while preserving audit context.                           |

The wrapper should be allowed to call Beads through either:

- the CLI JSON contract, which is runtime/language agnostic and stable for
  agent integration; or
- the Go API, which avoids process overhead and exposes storage transactions.

## 8. Live Update and Reconciliation

Beads does not provide an official live subscription stream for ready work. pdx
should keep its existing reconciliation posture:

- poll Beads every few seconds for ready work and state changes;
- optionally use Beads hooks or event cursors to wake reconciliation sooner;
- always derive decisions from current Beads state, not from hook/event payloads
  alone.

The efficient path is a metadata-filtered ready query. Example conceptual
filters:

```text
pdx_scope_kind=repo
pdx_scope_path=/Users/ct/dev/project
pdx_capability=execute
pdx_agent_kind=war
```

The spawned agent should still perform the actual claim using the same filter or
through a wrapper claim command. Observation by pdx is not ownership.

## 9. Beads Capabilities Worth Preserving

A migration should not obscure the parts of Beads that are valuable beyond
Pithos parity:

- Dolt-backed distributed history and sync;
- hash-based IDs that avoid concurrent-creation collisions;
- ready/blocked queries as a standard agent frontier;
- graph visualization and JSON inspection;
- formulas/protos/molecules for reusable workflow scaffolding;
- wisps for ephemeral local workflows;
- comments and audit records as durable agent context;
- metadata as a stable extension point;
- integrations with external trackers and community tooling.

The migration should avoid reimplementing these in pdx unless pdx needs
stronger invariants than Beads provides.

## 10. Risks and Open Questions

### Risks

- **Policy bypass:** raw `bd` mutations can bypass pdx wrapper invariants.
- **Closure ambiguity:** Beads connected components may include context that pdx
  does not consider branch membership.
- **Claim weakness:** Beads claims do not provide Pithos fencing or held-task
  semantics by default.
- **Late-growth safety:** Beads allows graph growth; it does not protect already
  released downstream work.
- **Artifact parity:** Beads has comments/metadata/issues, not Pithos artifact
  contracts.
- **Run parity:** Beads has no native Run lifecycle table.
- **Metadata drift:** top-level metadata conventions must be versioned and
  validated by pdx.
- **Dual authority:** allowing both raw Beads writes and wrapper writes may
  create ambiguous ownership unless the contract is explicit.

### Open Questions

- Should pdx forbid raw `bd` mutations in agent prompts, or merely prefer the
  wrapper for policy-sensitive writes?
- Should pdx represent Runs as metadata on work beads, separate run beads, or an
  external pdx runtime store?
- Should artifact beads use a custom `artifact` type, existing `decision`/`task`
  types, or metadata-only representation by default?
- Which Beads edge types count as pdx branch membership?
- Should pdx store `pdx_chain_id` on every bead, or rely on parent/root plus
  dependency traversal?
- How much Pithos Task Replay semantics are actually needed once Beads history
  and supersession are available?
- Would a Beads wrapper be implemented as part of `pdx`, as a separate `pdx-bd`
  command, or as a library boundary used by pdx?

## 11. Provisional Recommendation

If Pandora's Box migrates to Beads, start from the following durable model:

- Beads is the durable issue graph, history, sync, and inspection substrate.
- Every pdx chain has a root epic/molecule bead.
- Every pdx-managed bead carries top-level routing metadata.
- Dynamic graph growth is parented to the same root and linked with explicit
  dependency/provenance edges.
- pdx computes its own closure semantics over Beads state.
- pdx remains the authority for claims, fencing, runs, artifacts, repair,
  replay, and late-growth safety.
- Agents may inspect Beads directly, but policy-sensitive mutations go through
  pdx.

This preserves the strongest parts of both systems: Beads' durable distributed
work graph and Pandora's explicit control-plane semantics.
