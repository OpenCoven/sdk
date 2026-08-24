# SDK Plan Index

This directory contains both active execution plans and historical implementation procedures.

## Current plan of record

The active first-release program is:

- [`2026-08-22-sdk-0.1-delivery-program.md`](2026-08-22-sdk-0.1-delivery-program.md) — dependency-ordered 0.1 execution plan
- [`../specs/2026-08-22-sdk-0.1-read-only-release-design.md`](../specs/2026-08-22-sdk-0.1-read-only-release-design.md) — release boundary and trust model
- [OpenCoven/sdk#31](https://github.com/OpenCoven/sdk/issues/31) — program checklist

These files are introduced by the planning PR tracked in [#32](https://github.com/OpenCoven/sdk/issues/32). Until that PR merges, the GitHub issue graph is the authoritative active tracker.

## Historical plan reconciliation

See [`2026-08-22-sdk-plan-reconciliation.md`](2026-08-22-sdk-plan-reconciliation.md) for the evidence-backed status of older plans.

Historical plans preserve their original checkbox syntax and commands because they document how the work was intended to be executed. **Unchecked boxes in a historical plan are not active backlog.** Do not run an old plan literally without first consulting the reconciliation record and the current issue graph.

## Status summary

| Plan | Status | Current interpretation |
| --- | --- | --- |
| `2026-08-18-sdk-phase-0-reconciliation.md` | Completed | Delivered through PRs #9–#13; preserved as historical procedure |
| `2026-08-18-sdk-public-release-safeguards.md` | Completed | Safeguards landed through PRs #7–#8; publication remained locked |
| `2026-08-19-sdk-release-readiness.md` | Mechanism completed | Locked release system landed through PRs #14, #22, and #23; actual first publication is still unperformed and separately gated |
| `2026-08-20-sdk-beads-backlog.md` | Superseded as active tracker | Historical Beads reconstruction remains evidence; active delivery is tracked by SDK #31–#45 plus cross-repository blockers |

## Rules

1. Historical completion requires merged PR or commit evidence, not checkbox inference.
2. Deliberately unperformed external actions—publication, credential creation, tag creation, environment mutation, and cleanup—remain unperformed unless a current issue explicitly authorizes them.
3. A historical plan may be technically accurate for its date while no longer representing the current architecture or authority contract.
4. New work belongs in the current issue graph and current plan, not as new unchecked steps appended to a historical procedure.
5. Destructive repository cleanup requires separate evidence and approval under [#45](https://github.com/OpenCoven/sdk/issues/45).
