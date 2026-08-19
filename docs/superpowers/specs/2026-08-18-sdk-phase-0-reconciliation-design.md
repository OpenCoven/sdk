# SDK Phase 0 Reconciliation Design

**Status:** Approved
**Date:** 2026-08-18
**Bead:** `cave-o2bqs`

## Purpose

Reconcile the two clean, passing SDK Phase 0 implementation lines into current
`main` without discarding either line's intent or rewriting branch history.

The feature line ends at `95d2436` and contains later packaging, CI, Linux,
fixture-import, and owned-temporary-directory hardening. The review line ends at
`2d8d1c7` and contains stricter workspace, licensing, package-verification,
client-error, CLI, and public-contract corrections.

## Integration Strategy

Use the isolated branch `fix/cave-o2bqs-sdk-reconciliation`, based on current
`origin/main`.

1. Merge `feat/cave-o2bqs-sdk-foundation` with a merge commit.
2. Merge `fix/cave-o2bqs-sdk-review` with a merge commit.
3. Resolve overlapping files by preserving both sets of requirements.
4. Do not rebase, force-push, delete, or rewrite either source branch.

The review branch's stricter public API, normalized error, workspace,
licensing, and packed-package assertions take precedence when the branches
express different requirements. The feature branch's later CI ordering,
cross-platform temporary paths, atomic fixture synchronization, package
artifact ownership, and Linux/offline behavior remain intact.

## Conflict Resolution Boundaries

Expected conflicts are limited to package manifests, root TypeScript/Vitest
configuration, client implementations, CLI behavior, package verification,
licensing, documentation, and their tests.

Resolve conflicts semantically rather than selecting an entire side. Every
retained behavior must have a corresponding existing test from one of the two
branches or a focused reconciliation test when the combined behavior is new.
Do not add Phase 1 discovery, networking, credentials, or runtime I/O.

## Verification

Run focused tests for every conflicted area first, followed by:

```bash
corepack pnpm@10.34.0 verify
```

The final branch must:

- build all five packages and three examples;
- pass lint and typecheck;
- pass all merged tests;
- verify Cave and Coven contract fixtures;
- pack, install, and validate all five public packages;
- leave the worktree clean after generated artifacts are removed;
- contain no credentials, private keys, or production configuration.

Compare the final diff to `origin/main` and both source heads. Confirm that no
source-line capability disappears without an explicit, tested reason.

## Publication and Beads Evidence

Push only the reconciliation branch and open a pull request to `main`. Record
the source heads, conflict decisions, focused tests, full verification result,
files changed, security scan, and PR URL on `cave-o2bqs`.

Post this natural public note as a PR comment after the PR opens:

> Leaving myself a note here: both branches were green, but they had evolved
> independently. This PR combines the stricter review fixes with the later
> packaging, CI, and cross-platform hardening instead of treating either line
> as disposable. The conflict resolutions are intended to preserve both sets
> of guarantees; the verification notes below are the checklist for confirming
> that.

Do not close `cave-o2bqs` until the reconciliation PR contains complete
verification evidence. Do not start `cave-u0oli` until Beads marks its SDK
dependency closed.
