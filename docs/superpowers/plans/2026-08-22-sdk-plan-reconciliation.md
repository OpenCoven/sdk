# SDK Historical Plan Reconciliation

**Status:** Evidence ledger  
**Date:** 2026-08-22  
**Audited base:** `OpenCoven/sdk@3ab5b3132837282c812c0bf80074e4a15f35b161`  
**Tracker:** [OpenCoven/sdk#32](https://github.com/OpenCoven/sdk/issues/32)

## 1. Purpose

Older SDK plans preserve valuable implementation intent, command sequences, and review rationale. They also use unchecked checkbox syntax that can be mistaken for active work after the implementation has already merged or the architecture has advanced.

This record classifies those plans using merged evidence. It does not rewrite history, claim unverified red/green steps, or mark external actions complete merely because release tooling exists.

## 2. Classification rules

| Status | Meaning |
| --- | --- |
| **Completed** | The plan’s intended repository outcome is merged and evidenced by current-main ancestry and verification records. |
| **Mechanism completed** | The implementation mechanism is merged, while the external action it enables remains deliberately unperformed. |
| **Superseded as active tracker** | The document remains useful history, but current work has moved to a newer contract, plan, or issue graph. |
| **Partially completed** | Independently useful work landed, while named later tasks remain open under current tracking. |
| **External gate open** | The action mutates external systems or deletes state and still requires fresh authorization. |

Unchecked checkboxes in a document classified as historical preserve the original procedure. They are not evidence of incomplete current work.

## 3. Phase 0 reconciliation plan

**Plan:** [`2026-08-18-sdk-phase-0-reconciliation.md`](2026-08-18-sdk-phase-0-reconciliation.md)  
**Status:** **Completed**

### Intended outcome

Reconcile divergent SDK foundation and review branches, preserve both sets of guarantees, make the clean-install matrix reliable, and close Phase 0 with verified package boundaries and packed consumers.

### Merged evidence

| Evidence | Outcome |
| --- | --- |
| [PR #9](https://github.com/OpenCoven/sdk/pull/9) | Reconciled the independent Phase 0 implementation lines while preserving packaging, CI, fixture, review, and security guarantees. |
| [PR #10](https://github.com/OpenCoven/sdk/pull/10) | Matured the foundation with runtime-derived versions, additive health reporting, executable examples, and stronger verification. |
| [PR #11](https://github.com/OpenCoven/sdk/pull/11) | Made the clean-install matrix safe before build artifacts exist and retained packed CLI/package verification. |
| [PR #12](https://github.com/OpenCoven/sdk/pull/12) | Added current Cave familiar roster, Familiar Contract, and execution-analytics client operations without breaking older transports. |
| [PR #13](https://github.com/OpenCoven/sdk/pull/13) | Added cancellation, total deadlines, sanitized observers, hostile-input-safe error inspection, managed secret lifecycle, property tests, and stress coverage. |

### Current interpretation

The plan is historical. Do not recreate its branches, worktrees, Beads references, or merge sequence. Current `main` contains and has subsequently extended its intended guarantees.

The later discovery work in [PR #30](https://github.com/OpenCoven/sdk/pull/30) is new post-Phase-0 evolution, not evidence that the reconciliation plan remained open.

## 4. Public release safeguards plan

**Plan:** [`2026-08-18-sdk-public-release-safeguards.md`](2026-08-18-sdk-public-release-safeguards.md)  
**Status:** **Completed**

### Intended outcome

Protect the experimental public repository from accidental publication and credential leakage while retaining deterministic verification.

### Merged evidence

| Evidence | Outcome |
| --- | --- |
| [PR #7](https://github.com/OpenCoven/sdk/pull/7) | Constrained workflow permissions, restored staged secret scanning, resolved the dependency advisory, and blocked accidental npm publication. |
| [PR #8](https://github.com/OpenCoven/sdk/pull/8) | Recorded completion evidence, hosted alert results, and the build-before-typed-lint correction. |

### Current interpretation

The safeguards are delivered. Publication remains intentionally locked; that is success for this plan, not an incomplete checkbox.

Actual release authorization and registry mutation are tracked separately under [#41](https://github.com/OpenCoven/sdk/issues/41).

## 5. Release-readiness implementation plan

**Plan:** [`2026-08-19-sdk-release-readiness.md`](2026-08-19-sdk-release-readiness.md)  
**Status:** **Mechanism completed; first publication unperformed**

### Intended outcome

Build a fixed-group, fail-closed, checksummed release mechanism with protected deployment approval and no ordinary token fallback, without yet publishing packages.

### Merged evidence

| Evidence | Outcome |
| --- | --- |
| [PR #14](https://github.com/OpenCoven/sdk/pull/14) | Introduced the two-key locked release design and operationally ready release controls while keeping packages private. |
| [PR #22](https://github.com/OpenCoven/sdk/pull/22) | Landed the final locked release-readiness implementation, checksummed exact artifacts, protected OIDC/provenance workflow, support/security/bootstrap/rollback documentation, and expanded verification. |
| [PR #23](https://github.com/OpenCoven/sdk/pull/23) | Recorded the merge commit and successful post-merge canonical verification. |
| [PRs #24–#27](https://github.com/OpenCoven/sdk/pulls?q=is%3Apr+is%3Aclosed) | Repaired dependency/action maintenance assertions so secure pins remain bumpable and aligned Node typings with the supported runtime. |

### Deliberately unperformed

The following are **not** completed by the release-readiness plan and must not be inferred from its historical checkboxes:

- authorizing the first public version/package set;
- opening repository publication locks for a real release;
- creating the release tag;
- creating or modifying the protected npm environment;
- creating npm package records;
- using a one-time bootstrap credential;
- configuring trusted publishers;
- publishing to npm;
- validating registry bytes and live provenance.

Those external gates are now consolidated in [#41](https://github.com/OpenCoven/sdk/issues/41), which is blocked by the exact-candidate security disposition in [#40](https://github.com/OpenCoven/sdk/issues/40).

## 6. Beads backlog plan

**Plan:** [`2026-08-20-sdk-beads-backlog.md`](2026-08-20-sdk-beads-backlog.md)  
**Status:** **Superseded as the active tracker; retained as historical reconstruction**

### Merged evidence

[PR #28](https://github.com/OpenCoven/sdk/pull/28) created a durable repository-local ledger, reconstructed completed milestones, and recorded the then-current dependency chain.

### Current mapping

| Historical Bead area | Current GitHub tracker |
| --- | --- |
| `sdk-cli-scope` | [#37](https://github.com/OpenCoven/sdk/issues/37) |
| `sdk-plan-reconcile` | [#32](https://github.com/OpenCoven/sdk/issues/32) and this record |
| first-release authorization/governance/security/unlock/rehearsal/bootstrap/trusted publishing/validation | [#40](https://github.com/OpenCoven/sdk/issues/40) and [#41](https://github.com/OpenCoven/sdk/issues/41) |
| state audit and cleanup | [#45](https://github.com/OpenCoven/sdk/issues/45) |
| complete 0.1 program | [#31](https://github.com/OpenCoven/sdk/issues/31) |

The Beads ledger remains useful local provenance. New active planning and cross-repository dependencies belong in the current GitHub issue graph and the 0.1 delivery program, rather than as additional unchecked lines in the historical reconstruction.

## 7. Phase 1 discovery/pairing plan

**Plan location:** `OpenCoven/chat/docs/superpowers/plans/2026-08-20-phase-1b-sdk-discovery-pairing.md`  
**Status:** **Partially completed and superseded for remaining work**

### Completed SDK lane

[SDK PR #30](https://github.com/OpenCoven/sdk/pull/30) completed the independent Coven discovery/IPC lane:

- shared discovery contracts;
- explicit `COVEN_HOME` and trusted exact-command discovery;
- constrained Unix and Windows transports;
- mandatory platform trust providers;
- bounded deadlines and framing;
- structured safe errors;
- import purity and full repository verification.

### Remaining work moved to current trackers

The older plan’s Cave pairing and CLI steps assumed an earlier authority snapshot. The live Cave now has a real Client v1 discovery writer, compatibility health, pairing/credential authority, five canonical reads, and real-socket conformance findings.

Remaining work is therefore re-specified rather than executed literally:

- contract/capability truth: [Cave #4869](https://github.com/OpenCoven/coven-cave/issues/4869) and [SDK #33](https://github.com/OpenCoven/sdk/issues/33);
- secure Cave discovery: [#34](https://github.com/OpenCoven/sdk/issues/34);
- pairing and credential custody: [#35](https://github.com/OpenCoven/sdk/issues/35);
- canonical reads and bounded pagination: [#36](https://github.com/OpenCoven/sdk/issues/36);
- CLI/native trust decision: [#37](https://github.com/OpenCoven/sdk/issues/37);
- packed Chat integration: [Chat #27](https://github.com/OpenCoven/chat/issues/27);
- real-authority completion: [#38](https://github.com/OpenCoven/sdk/issues/38).

## 8. Current plan of record

The active plan is introduced by the planning PR tracked in [#32](https://github.com/OpenCoven/sdk/issues/32):

- `docs/superpowers/specs/2026-08-22-sdk-0.1-read-only-release-design.md`
- `docs/superpowers/plans/2026-08-22-sdk-0.1-delivery-program.md`
- `docs/ROADMAP.md`
- [Program issue #31](https://github.com/OpenCoven/sdk/issues/31)

Until that planning PR merges, the GitHub issue graph is authoritative.

## 9. Open external/destructive gates

These remain intentionally open and require current evidence plus fresh authorization:

- first public release and all npm/OIDC/environment mutations — [#41](https://github.com/OpenCoven/sdk/issues/41);
- first-release security ship/block disposition — [#40](https://github.com/OpenCoven/sdk/issues/40);
- repository branch/worktree/stash cleanup — [#45](https://github.com/OpenCoven/sdk/issues/45).

Creating an issue, plan, or branch is not authorization to execute those mutations.

## 10. Validation of this reconciliation

This record was checked against:

- current `main` at `3ab5b313`;
- merged PR history through #30;
- the repository-local Beads export;
- the current Cave Client v1 authority and real-socket evidence;
- the newly created dependency-linked GitHub issue graph.

No source code, package manifest, workflow, publication lock, tag, credential, npm state, branch, worktree, or stash was changed by this reconciliation.
