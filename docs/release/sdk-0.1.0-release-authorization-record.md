# SDK 0.1.0 first-release authorization record

**Status: PENDING FRESH MAINTAINER AUTHORIZATION — nothing in this record
authorizes or performs any external mutation.**

This record is the preparatory deliverable for
[OpenCoven/sdk#41](https://github.com/OpenCoven/sdk/issues/41) (parent
[#31](https://github.com/OpenCoven/sdk/issues/31)). The release decision itself
is **not** made here. Creating, assigning, or commenting on #41 is not
authorization. Every externally visible action listed in
[RELEASING.md](../../RELEASING.md) and in the
[0.1.0 no-publish rehearsal runbook](../workflows/first-release-rehearsal-runbook.md)
requires a fresh, explicit, current maintainer authorization recorded in the
#41 thread at execution time.

Prepared by the #41 preparatory executor on the stacked branch
`release/sdk-0.1.0-unlock-41` (fork PR review artifact). No tag, no registry
mutation, no unlock activation, no release-workflow dispatch, and no secret
storage was performed or authorized by this record.

## 1. Proposed release decision (pending)

| Field | Value | State |
|---|---|---|
| Decision | Approve executing the first public SDK release sequence | **Pending fresh maintainer authorization** |
| Fixed-group version | `0.1.0` (exact, strict SemVer; pinned by `tests/package-manifests.spec.ts` and `tests/release-readiness.spec.ts`) | Proposed |
| Package set | `@opencoven/sdk-core`, `@opencoven/cave-client`, `@opencoven/coven-client`, `@opencoven/sdk` — in this canonical order (`release.config.json` `packages`; `scripts/repository-metadata.mjs` `PUBLIC_PACKAGES`) | Proposed |
| `@opencoven/dev-cli` | **Deferred** — stays private and outside the 0.1 release group. Recorded in-repo by commit `11952ee` ("build: defer private CLI from SDK 0.1 release (#57)", which removed dev-cli from the changesets fixed group), `RELEASING.md` ("`@opencoven/dev-cli` is not part of the 0.1 release group"), and `tests/package-manifests.spec.ts` (CLI stays `private: true`, owns the `opencoven` binary, and is excluded from `PUBLIC_PACKAGES`). What shipped: the CLI remains a private, source-tested workspace; the global `opencoven` binary is **not** part of the first public release, so issue #41's "global CLI behavior if released" validation criterion is **not applicable**. | Verified in-repo |
| Supported Node runtime | `>=24.18.0 <25` (`release.config.json` `supportedNode`; `.node-version` = `24.18.1`; `engines.node` on every workspace package, `engine-strict` in `.npmrc`) | Verified in-repo |
| OS / architecture matrix | The published packages are pure TypeScript/JavaScript: no `os`/`cpu` fields, no `optionalDependencies` native artifacts (verified in the four manifests; see the security review's Native/CLI boundary). Runtime support follows the Node line above on any OS/architecture Node 24.18–24.x supports. Separately, the 0.1 **native Chat/real-authority conformance release-gate matrix** is frozen to `darwin-arm64`, `linux-x64`, `win32-x64` (`release.config.json` `nativeConformancePlatforms`; enforced verbatim by `scripts/release-readiness.mjs`) — this gate matrix, not runtime support, is what finding F-1 blocks on. | Verified in-repo |
| Launch criteria | All of §4 below hold at execution time | Pending |
| Rollback owner | Repository owner/maintainer `@BunsDev` (sole CODEOWNERS owner of `release.config.json`, `scripts/*release*`, `.github/workflows/`; sole required reviewer of the `npm-release` environment). npm rollback follows RELEASING.md §10–11 (deprecate, dist-tag move only after review, corrective release). | Proposed — **requires maintainer confirmation** of the named human |

## 2. Governance prerequisites — verified with evidence

### 2a. Verified directly from repository config and workflow files

- **Two independent locks, by construction.** Repository lock:
  `release.config.json` `publishingEnabled` plus the four manifests'
  `private` flag, validated on both sides by
  `scripts/release-readiness.mjs:268-277`. Deployment lock: the release
  workflow's publish job runs only with `environment: npm-release`
  (`.github/workflows/release.yml:82`), after `needs: preflight`, only from
  `main` (`release.yml:42-46`), and only for `inputs.mode == 'publish'`
  (`release.yml:78`). This PR opens the first lock as a reviewed change; it
  does not touch the second.
- **Protected-environment and OIDC requirements preserved.** The publish job
  keeps `contents: read`, `id-token: write`, `attestations: write`
  (`release.yml:85-88`), re-validates publication gates before publishing
  (`release.yml:107-113`), and the readiness validator fails if the publish
  job's environment or permission block is weakened
  (`scripts/release-readiness.mjs:128-172`). Untouched by this change.
- **No token fallback, by construction.** `scripts/publish-release-artifacts.mjs:58-62`
  throws when `NPM_TOKEN` or `NODE_AUTH_TOKEN` is present; npm is invoked only
  with `--provenance` and exact reviewed tarballs
  (`publish-release-artifacts.mjs:26-34`). No workflow file references either
  variable; no npm/GitHub secret is stored or requested by this change.
- **Defense-in-depth authorization gate.** Every package manifest keeps
  `prepublishOnly: node ../../scripts/require-release-authorization.mjs`, and
  the publish script requires `OPENCOVEN_RELEASE_AUTHORIZATION=publish`
  (`publish-release-artifacts.mjs:55-57`). Finding F-3 of the security review
  records this as in-workflow defense-in-depth, not an independent control.
- **Least-privilege, SHA-pinned automation.** All `uses:` pins in both
  workflows are full commit SHAs (`tests/workflow-pins.spec.ts` enforces);
  workflow permissions are `contents: read` except the publish job.
- **Release ownership.** `.github/CODEOWNERS` assigns
  `/.github/workflows/`, `/release.config.json`, and `/scripts/*release*` to
  `@BunsDev`.
- **Fixed-version group mechanics.** `.changeset/config.json` declares exactly
  the four release packages as one `fixed` group with exact
  `workspace:0.1.0` internal ranges (enforced by
  `scripts/release-readiness.mjs` and `tests/package-manifests.spec.ts`).
  The pre-release changesets were consumed into the `## 0.1.0` changelog
  entries by this PR, so no version bump is pending.

### 2b. Verified live from the GitHub API with the executor token (read-only, 2026-08-30)

- **`npm-release` environment exists and is protected**
  (`GET /repos/OpenCoven/sdk/environments` → 200): environment `npm-release`
  (created 2026-08-28T11:54:54Z), `can_admins_bypass: false`, protection rules
  = `required_reviewers` with `prevent_self_review: true` and reviewer
  `BunsDev`, plus a branch policy restricted to protected branches. This
  matches the maintainer record in
  [#41 (comment 5452204150)](https://github.com/OpenCoven/sdk/issues/41#issuecomment-5452204150).
- **Companion publication environments exist**: `publication-candidate` and
  `npm-publish` (both created 2026-08-30T00:00Z, `can_admins_bypass: false`,
  branch policy restricted to protected branches) — consistent with PR
  [#74](https://OpenCoven/sdk/pull/74)'s environment-policy receipts. They are
  recorded here as observed state; this change binds nothing to them.
- **Release workflow is active** (`GET /repos/OpenCoven/sdk/actions/workflows`
  → 200; `.github/workflows/release.yml`, state `active`).

### 2c. Recorded by the maintainer in the #41 thread (point-in-time; re-confirm at execution)

Source: [#41 (comment 5452182687)](https://github.com/OpenCoven/sdk/issues/41#issuecomment-5452182687)
and [#41 (comment 5452204150)](https://github.com/OpenCoven/sdk/issues/41#issuecomment-5452204150),
both by `BunsDev` on 2026-08-28:

- npm organization ownership is held and org-level **auth-and-writes 2FA** is
  enabled.
- All four package names returned registry `E404` — no name conflict; the
  documented one-time bootstrap remains required for first publish.
- Before 11:54Z on 2026-08-28 the `npm-release` environment did not exist; it
  was then created restricted to `main` with deployment review required (since
  independently re-verified live in §2b).

## 3. Requires maintainer confirmation (not independently verifiable or not yet decided)

The executor token cannot read these, or no decision exists yet. None is
assumed, guessed, or pre-authorized:

1. **Branch protection / required checks on `main`.**
   `GET /repos/OpenCoven/sdk/branches/main/protection` → 403 ("Resource not
   accessible by personal access token"). The 2026-08-28 maintainer audit
   records that `main` requires the two Node verification jobs, CodeQL, and
   linear history, but **zero approving reviews**. The maintainer must confirm
   the branch-protection decision for the release (in particular whether pull
   request approval is required before activation merges).
2. **One-time bootstrap owner.** The named human who will hold the
   least-privilege, 2FA-protected, revoke-after-use npm automation credential
   for the first publish has not been recorded. Must be named in the #41
   thread at execution time.
3. **npm organization/package ownership state at execution time** — org
   membership, 2FA, and name availability are point-in-time facts recorded
   2026-08-28; re-confirm immediately before bootstrap.
4. **`npm-release` reviewer binding at execution time** — confirmed live in
   §2b, but reviewer assignment is a mutable setting; re-confirm before the
   publish-mode dispatch.
5. **Resolution or formal waiver of finding F-1** — the inherited #38 gap:
   Chat schema-v2 real-authority records on `darwin-arm64`, `linux-x64`, and
   `win32-x64`, the aggregate record, and the PR #74 `conformanceEvidence`
   gate. Only a maintainer can resolve or formally waive this before any
   external mutation.
6. **Artifact retention count.** The issue asks for "five-or-approved-count
   tarballs". The canonical system produces **four** package tarballs plus
   `release-manifest.json`, checksums, and attestations. The approved retention
   count must be confirmed (the runbook default: the immutable workflow
   artifact `opencoven-sdk-0.1.0`, retention extended from the workflow's 7
   days per the maintainer's approved count).
7. **Rollback owner confirmation** — the named human accepting RELEASING.md
   §10–11 duty.

## 4. Launch criteria (all must hold before any external mutation)

1. Fresh, explicit, current maintainer authorization recorded in #41 for the
   specific mutation class about to be executed (tag; verify-mode dispatch;
   bootstrap publish; trusted-publisher configuration; normal publication),
   per the runbook's stop points.
2. Fork PR #1 (security/first-release-review-40) and this unlock PR are merged
   upstream; this branch is rebased on `origin/main` per the PR body's stack
   instructions; `corepack pnpm@10.34.0 verify` + `git diff --exit-code` pass
   in a clean checkout of the release commit.
3. Finding F-1 (#38 platform records on `darwin-arm64`, `linux-x64`,
   `win32-x64`, aggregate record through the PR #74 gate) is **resolved or
   formally waived by a maintainer**.
4. `npm-release` environment protection re-verified live (§2b state) with a
   named, available reviewer.
5. Branch-protection decision confirmed (§3 item 1).
6. Bootstrap owner named, credential handling plan confirmed (§3 item 2), and
   the no-token-storage rules restated: no token in repository files, GitHub
   secrets for future use, workflow logs, argv, or shell history; revoke
   immediately after bootstrap.
7. Registry state re-proven unchanged (all four names `E404`) immediately
   before bootstrap.

## 5. What this record deliberately does not do

It does not approve, schedule, or execute: tag creation, release-workflow
dispatch (verify or publish mode), npm bootstrap publishing, trusted-publisher
configuration, environment changes, branch-protection changes, secret storage,
or any registry mutation. Those remain behind the absolute stop in the #41
prompt, the runbook's authorization gates, and the two-key system.
