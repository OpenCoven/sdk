# SDK Beads Backlog Design

**Status:** Approved
**Date:** 2026-08-20
**Repository:** `OpenCoven/sdk`

## Purpose

Create the SDK's first repository-owned Beads database from current source,
plans, merged delivery evidence, local branch/worktree state, and live GitHub
state. The database must distinguish completed history from genuinely remaining
work so that `bd ready` is an actionable queue rather than a transcription of
stale unchecked plan steps.

## Chosen Approach

Use a shared lifecycle ledger:

- track the Beads database as project state rather than a local stealth store;
- summarize landed work as closed phase-level epics and tasks with PR and commit
  evidence;
- create open Beads only for concrete unresolved decisions, tasks, and chores;
- express ordering and approval gates as dependencies;
- preserve external approval boundaries instead of marking gated release work
  ready prematurely.

This avoids both an active-only backlog, which would lose the provenance of the
SDK's plans and historical branch names, and a full checklist import, which
would create dozens of closed or misleading issues from implementation-plan
steps.

## Database Ownership and Initialization

- Initialize a repository-local Dolt Beads database with prefix `sdk`.
- Use non-interactive maintainer initialization.
- In linked Git worktrees, allow Beads to anchor the shared database at the
  common Git root as designed; code verification may remain isolated while
  repository-owned Beads metadata is committed from the canonical checkout.
- Keep the existing repository instructions untouched: initialization must not
  generate or overwrite `AGENTS.md` and must not install unrelated Git hooks.
- Track the repository-owned Beads metadata and exported issue ledger needed by
  the installed `bd` version. Runtime sockets, logs, process identifiers, and
  machine-local state remain ignored.
- Enable automatic JSONL export for reviewable issue-level interchange. Dolt
  history remains the authoritative database history.
- Never edit generated Beads database files or JSONL by hand; use `bd` commands.

The implementation must inspect the exact files produced by the installed
version before staging them. Only Beads-owned project files may be committed.

## Backlog Model

### Closed delivery history

Create closed records with exact GitHub and commit evidence:

1. **Epic: Deliver the SDK Phase 0 foundation**
   - Child: foundation and experimental security guardrails, covering PRs
     #1-#8.
   - Child: reconcile and mature the Phase 0 implementation, covering PRs
     #9-#13 and the historical `cave-o2bqs` / `cave-u0oli` references.
   - Closure evidence must identify the merged PRs and confirm their merge
     commits remain ancestors of current `main`.

2. **Epic: Build the locked SDK release-readiness system**
   - Child: fixed-version release contract, artifacts, protected workflow,
     policies, and packed verification, covering PRs #14, #22, and #23.
   - Child: dependency and workflow maintenance through PR #27.
   - Closure evidence must record that publishing remains intentionally locked;
     completion means the release mechanism landed, not that packages shipped.

Historical plan checklist lines are evidence sources, not one Bead per step.

### Open documentation reconciliation

Create one P2 task to reconcile the two completed plans that still contain
unchecked historical execution steps:

- `docs/superpowers/plans/2026-08-18-sdk-phase-0-reconciliation.md`
- `docs/superpowers/plans/2026-08-19-sdk-release-readiness.md`

Acceptance criteria:

- each document has an unambiguous completed/merged status;
- historical checkboxes are reconciled only where repository and PR evidence
  supports completion;
- no unchecked line is left looking like current actionable work;
- completion records retain exact PRs, merge commits, verification, and any
  deliberately unperformed external release operations.

### Open repository-state retirement

Create a P3 maintenance epic with two ordered children:

1. **Audit legacy branches, worktrees, and the preserved stash.**
   Prove each branch is merged, patch-equivalent, superseded, unique, or still
   needed. Compare the named stash against current `main`; current source already
   contains its verifier-isolation concepts, but deletion requires exact
   patch-equivalence evidence.
2. **Retire only approved superseded state.**
   This child depends on the audit and an explicit maintainer approval recorded
   in the Bead. It must not delete worktrees, branches, or the stash merely
   because they appear old.

The audit is ready work. Destructive cleanup is blocked until its evidence and
approval exist.

### Open first-release program

Create a P1 epic for the first public SDK release. Its children form this
dependency chain:

1. **Decision: authorize the first release and target version.**
   Record whether the experimental SDK is approved to ship, the version, scope,
   and the maintainer who authorizes unlocking publication.
2. **Reconcile release governance prerequisites.**
   Confirm npm organization ownership, account 2FA, package-name/bootstrap
   constraints, and the protected `npm-release` environment. Branch protection
   remains unchanged unless separately approved; this task must surface that
   existing constraint rather than silently modifying it.
3. **Complete the release-scope security review.**
   Review package surfaces, release scripts/workflows, dependency findings,
   secret handling, provenance, and the documented production boundary. Record
   findings and disposition before publication unlock.
4. **Prepare the reviewed launch/unlock change.**
   Version all five fixed-group packages, update changelogs and internal ranges,
   open the repository publishing lock, and preserve the two-key environment
   gate. This remains a reviewed PR; no direct push to `main`.
5. **Tag and run the verify-mode artifact rehearsal.**
   From the exact reviewed merge commit, create the annotated SDK tag, run
   verify mode, and retain the five tarballs, manifest, checksums, and
   attestations without publishing.
6. **Perform the one-time bootstrap publication.**
   Publish the verified tarballs in canonical order with an explicitly approved
   least-privilege bootstrap credential, verify ownership and package contents,
   then revoke the credential and record the audit trail.
7. **Configure all five npm trusted publishers.**
   Bind each package to `OpenCoven/sdk`, the exact release workflow, and the
   protected release environment.
8. **Validate registry, provenance, and normal OIDC readiness.**
   Verify versions, dist-tags, manifests, licenses, changelogs, binaries,
   dependency ranges, hashes, npm provenance, GitHub attestations, and clean
   consumer installation. Confirm future publish mode has no token fallback.

Within the release epic, only the authorization decision is initially ready.
Every later child depends on all prior gates that it consumes. External
mutations such as creating npm records, environments, tags, releases, or
publisher bindings require explicit authorization at execution time; the Beads
graph does not grant it.

### Open CLI scope decision

Create one P2 decision Bead to define which operational commands, if any, the
`opencoven` CLI should own. Its acceptance criteria are an approved command
surface, ownership boundary, transport/auth constraints, compatibility policy,
and follow-up implementation Beads. Do not invent feature tasks from the current
`not_implemented` placeholder before this decision closes.

## Labels and Evidence

Use a small stable label vocabulary:

- `phase-0`
- `release`
- `security`
- `maintenance`
- `docs`
- `cli`
- `external-gate`
- `historical`

Every Bead includes:

- concise problem or outcome statement;
- repository paths or owning external surface;
- acceptance criteria;
- PR, commit, plan, or document references when available;
- explicit approval requirements for external or destructive actions.

Use GitHub URLs as external references where one canonical PR owns the record.
Use notes for additional PRs and merge commits. Historical Cave task IDs are
references only; they are not recreated as active SDK tasks.

## Dependency and Priority Rules

- P1: first-release authorization and its gated delivery chain.
- P2: plan reconciliation and CLI scope decision.
- P3: repository-state retirement.
- Closed historical work retains the priority appropriate to its delivered
  phase but never appears in `bd ready`.
- Parent epics remain open orchestration containers until all required children
  close. Beads 1.0.5 does not allow an epic to depend on a task, so worker queue
  queries exclude epics rather than adding an invalid terminal-child blocker.
- Dependency direction must be validated with `bd dep tree` and
  `bd dep cycles`; no cycles are permitted.
- `bd ready` must initially expose only genuinely actionable decisions or
  audits, never bootstrap publication or destructive cleanup.

## Verification

After construction:

1. `bd context` resolves the SDK database and `sdk` prefix.
2. `bd list --json` contains the designed closed history and open backlog with
   no duplicate plan or PR records.
3. `bd ready --exclude-type epic --json` contains only actionable leaf work.
4. `bd blocked --json` explains every gated release or cleanup item through an
   explicit dependency.
5. `bd dep cycles` reports no dependency cycles.
6. Closed records contain verifiable merged PR and ancestor evidence.
7. The exported ledger is current and repository-owned Beads files are the only
   working-tree changes besides this approved documentation.
8. A fresh `pnpm verify` confirms backlog initialization did not affect SDK
   behavior or release safeguards.

## Non-Goals

- Do not publish packages, create tags/releases, configure npm or GitHub
  environments, or change branch protection.
- Do not delete branches, worktrees, or stashes during backlog construction.
- Do not reopen completed implementation-plan steps as engineering work.
- Do not create speculative CLI feature Beads before the scope decision.
- Do not create a duplicate GitHub issue queue merely to mirror Beads.

## Completion Criteria

- The SDK has a shared `sdk`-prefixed Beads database with reviewable project
  state.
- Landed plans and PRs are represented as closed evidence-backed history.
- Every unresolved task discovered in the reviewed plans and repository state
  is open, prioritized, and dependency ordered.
- Approval-bound work is blocked explicitly.
- `bd ready` is small, honest, and actionable.
- Database, dependency, export, Git, and SDK verification all pass.
