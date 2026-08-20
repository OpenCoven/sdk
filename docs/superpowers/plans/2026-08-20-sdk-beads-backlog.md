# SDK Beads Backlog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Initialize a shared SDK Beads database that preserves completed delivery evidence and exposes a small, dependency-ordered backlog of genuinely remaining work.

**Architecture:** Use the installed Dolt-backed `bd` CLI with stable `sdk-*` IDs, phase-level closed history, and explicit dependencies for release and destructive-action gates. Keep machine-local Dolt runtime files ignored, export the issue ledger to tracked JSONL, and verify Beads state independently from SDK behavior.

**Tech Stack:** Beads `bd` CLI, embedded Dolt, JSONL, Git, GitHub REST API via `gh api`, jq, pnpm 10.34.0.

---

## File Map

**Create through `bd init`:**

- `.beads/.gitignore` — excludes Dolt data and machine-local runtime state.
- `.beads/README.md` — generated Beads repository guidance.
- `.beads/config.yaml` — project Beads and export configuration.
- `.beads/interactions.jsonl` — generated interaction ledger.
- `.beads/metadata.json` — backend and project identity metadata.
- `.beads/issues.jsonl` — reviewable export of the designed issue graph.

**Modify through `bd init`:**

- `.gitignore` — generated Beads integration exclusions.

**Reference without modifying:**

- `docs/superpowers/specs/2026-08-20-sdk-beads-backlog-design.md`
- `docs/superpowers/plans/2026-08-18-sdk-phase-0-reconciliation.md`
- `docs/superpowers/plans/2026-08-19-sdk-release-readiness.md`
- `release.config.json`
- `RELEASING.md`
- `packages/cli/README.md`

`bd init` creates its own Git commit for generated initialization files. Later
issue writes are committed to Dolt in bounded batches, then exported and
committed to Git once the graph has passed verification.

### Task 1: Verify the baseline and initialize Beads

**Files:**

- Create: `.beads/.gitignore`
- Create: `.beads/README.md`
- Create: `.beads/config.yaml`
- Create: `.beads/interactions.jsonl`
- Create: `.beads/metadata.json`
- Modify: `.gitignore`

- [ ] **Step 1: Confirm the feature branch is clean and current**

Run:

```bash
git fetch --prune origin
git status --short --branch
git merge-base --is-ancestor origin/main HEAD
test ! -e .beads
```

Expected: the isolated implementation branch is clean, contains the approved
spec and plan plus current `origin/main`, and `.beads` does not exist.

- [ ] **Step 2: Reconfirm the live GitHub boundary**

Run:

```bash
gh api 'repos/OpenCoven/sdk/issues?state=open&per_page=100' \
  --jq 'map(select(.pull_request|not)|{number,title,html_url})'
gh api 'repos/OpenCoven/sdk/pulls?state=open&per_page=100' \
  --jq 'map({number,title,html_url})'
gh api 'repos/OpenCoven/sdk/dependabot/alerts?state=open&per_page=100' \
  --jq 'map({number,dependency:.dependency.package.name,severity:.security_advisory.severity})'
gh api 'repos/OpenCoven/sdk/code-scanning/alerts?state=open&per_page=100' \
  --jq 'map({number,rule:.rule.id,severity:.rule.security_severity_level})'
```

Expected: no open SDK issues, PRs, Dependabot alerts, or CodeQL alerts. If live
state differs, stop and add only evidence-backed work to the design before
constructing the database.

- [ ] **Step 3: Initialize the repository-owned database**

Run:

```bash
bd init \
  --prefix sdk \
  --non-interactive \
  --role maintainer \
  --skip-agents \
  --skip-hooks
```

Expected: embedded Dolt database `sdk`, issue prefix `sdk`, no generated
`AGENTS.md`, no added Beads hooks, and one automatic Git commit titled
`bd init: initialize beads issue tracking`.

- [ ] **Step 4: Inspect the generated scope before further writes**

Run:

```bash
git show --stat --oneline HEAD
git show --name-only --format= HEAD
git status --short --branch
git ls-files .beads .gitignore
```

Expected: only the five generated `.beads` metadata files plus `.gitignore` are
tracked; Dolt data, locks, sockets, logs, and local version files are ignored.

- [ ] **Step 5: Enable the reviewable issue export**

Run:

```bash
bd config set export.auto true
bd config set export.path issues.jsonl
bd config set import.path issues.jsonl
bd config get export.auto
bd config get export.path
bd config get import.path
```

Expected: `true`, `issues.jsonl`, and `issues.jsonl`. Do not configure a Dolt
remote or claim JSONL is a full Dolt backup.

### Task 2: Record closed Phase 0 delivery history

**Files:**

- Modify through `bd`: `.beads/issues.jsonl`

- [ ] **Step 1: Prove the referenced Phase 0 merges remain on `main`**

Run:

```bash
for pr in 1 2 3 4 5 6 7 8 9 10 11 12 13; do
  gh api "repos/OpenCoven/sdk/pulls/$pr" \
    --jq '{number,state,merged_at,merge_commit_sha,html_url}'
done
for sha in 33091b7 72888c2 2291002 a1c24d2; do
  git merge-base --is-ancestor "$sha" origin/main
done
```

Expected: every PR is closed with a non-null `merged_at`, and every named merge
commit is an ancestor of `origin/main`.

- [ ] **Step 2: Create the historical epic**

Run:

```bash
bd --dolt-auto-commit=batch create \
  --id sdk-phase0 \
  --title 'Deliver the SDK Phase 0 foundation' \
  --type epic \
  --priority P1 \
  --labels phase-0,historical \
  --description 'Historical delivery epic for the public TypeScript SDK foundation, security safeguards, reconciliation, maturity, Cave analytics, and runtime hardening.' \
  --acceptance 'All child delivery records are closed with merged PR and current-main ancestry evidence.' \
  --spec-id docs/superpowers/specs/2026-08-18-sdk-phase-0-reconciliation-design.md
```

Expected: `sdk-phase0` is open pending its historical children.

- [ ] **Step 3: Create the foundation and safeguards child**

Run:

```bash
bd --dolt-auto-commit=batch create \
  --id sdk-phase0-foundation \
  --parent sdk-phase0 \
  --title 'Land the SDK foundation and security safeguards' \
  --type task \
  --priority P1 \
  --labels phase-0,security,historical \
  --external-ref https://github.com/OpenCoven/sdk/pull/1 \
  --description 'Historical record for PRs #1-#8: initial SDK packages, licenses, CI repair, experimental warning, leak prevention, publication lock, and safeguards completion record.' \
  --acceptance 'PRs #1-#8 are merged or intentionally superseded, required merge commits are ancestors of main, and security/release gates remain represented in current source.' \
  --notes 'Primary merges: PR #1 33091b7; PR #2 72888c2; PR #7 2291002; PR #8 a1c24d2.'
```

Expected: `sdk-phase0-foundation` is a child of `sdk-phase0`.

- [ ] **Step 4: Create the reconciliation and maturity child**

Run:

```bash
bd --dolt-auto-commit=batch create \
  --id sdk-phase0-reconcile \
  --parent sdk-phase0 \
  --title 'Reconcile and mature the Phase 0 SDK' \
  --type task \
  --priority P1 \
  --labels phase-0,historical \
  --external-ref https://github.com/OpenCoven/sdk/pull/9 \
  --description 'Historical record for PRs #9-#13: reconcile independent implementation lines, mature package boundaries, make the clean-install matrix safe, add Cave familiar analytics, and harden runtime operations.' \
  --acceptance 'PRs #9-#13 are merged, their guarantees remain on current main, and historical Cave task references are not recreated as open SDK work.' \
  --notes 'Historical cross-repository references: cave-o2bqs and cave-u0oli. SDK delivery continued through PRs #9, #10, #11, #12, and #13.'
```

Expected: `sdk-phase0-reconcile` is a child of `sdk-phase0`.

- [ ] **Step 5: Close the verified historical records**

Run:

```bash
bd --dolt-auto-commit=batch close sdk-phase0-foundation \
  --reason 'Completed through merged PRs #1-#8; merge evidence remains on current main.'
bd --dolt-auto-commit=batch close sdk-phase0-reconcile \
  --reason 'Completed through merged PRs #9-#13; historical Cave references are delivery evidence, not open SDK work.'
bd --dolt-auto-commit=batch close sdk-phase0 \
  --reason 'Phase 0 foundation, safeguards, reconciliation, and maturity are delivered on main.'
bd dolt commit -m 'Record completed SDK Phase 0 delivery'
```

Expected: all three records are closed and one Dolt commit records the batch.

### Task 3: Record closed release-readiness history

**Files:**

- Modify through `bd`: `.beads/issues.jsonl`

- [ ] **Step 1: Prove release-readiness and maintenance merges**

Run:

```bash
for pr in 14 22 23 15 16 17 18 19 20 21 24 25 26 27; do
  gh api "repos/OpenCoven/sdk/pulls/$pr" \
    --jq '{number,state,merged_at,merge_commit_sha,html_url}'
done
git merge-base --is-ancestor 35b67b7 origin/main
git merge-base --is-ancestor d32738a origin/main
```

Expected: every PR is merged and both the release-system merge and latest
maintenance merge are ancestors of `origin/main`.

- [ ] **Step 2: Create the release-readiness epic and children**

Run:

```bash
bd --dolt-auto-commit=batch create \
  --id sdk-release-ready \
  --title 'Build the locked SDK release-readiness system' \
  --type epic \
  --priority P1 \
  --labels release,security,historical \
  --description 'Historical delivery epic for fixed versioning, fail-closed publication, checksummed artifacts, Node support gates, protected workflow identity, policies, and packed release verification.' \
  --acceptance 'Release controls and subsequent maintenance are closed with merge evidence while publishing remains intentionally disabled.' \
  --spec-id docs/superpowers/specs/2026-08-19-sdk-release-readiness-design.md

bd --dolt-auto-commit=batch create \
  --id sdk-release-system \
  --parent sdk-release-ready \
  --title 'Land the two-key locked release system' \
  --type task \
  --priority P1 \
  --labels release,security,historical \
  --external-ref https://github.com/OpenCoven/sdk/pull/22 \
  --description 'Historical record for PRs #14, #22, and #23: release design, implementation, independent review fixes, hosted verification, and completion documentation.' \
  --acceptance 'The release system is merged, publishingEnabled remains false, packages remain private, and the current verifier enforces release contracts.' \
  --notes 'Release implementation merged as 35b67b7; completion documentation landed in PR #23.'

bd --dolt-auto-commit=batch create \
  --id sdk-deps-through-27 \
  --parent sdk-release-ready \
  --title 'Complete dependency and workflow maintenance through PR #27' \
  --type chore \
  --priority P2 \
  --labels maintenance,historical \
  --external-ref https://github.com/OpenCoven/sdk/pull/27 \
  --description 'Historical record for merged dependency and workflow-action maintenance in PRs #15-#21 and #24-#27, including support-matrix pin repairs.' \
  --acceptance 'All referenced PRs are merged, latest main checks pass, and no open Dependabot or CodeQL alert remains.'
```

Expected: one epic with two historical children.

- [ ] **Step 3: Close the verified release-readiness records**

Run:

```bash
bd --dolt-auto-commit=batch close sdk-release-system \
  --reason 'Release-readiness controls landed through PRs #14, #22, and #23; publication remains intentionally locked.'
bd --dolt-auto-commit=batch close sdk-deps-through-27 \
  --reason 'Dependency and action maintenance through PR #27 is merged and green on main.'
bd --dolt-auto-commit=batch close sdk-release-ready \
  --reason 'The locked release-readiness mechanism is delivered; actual first publication is tracked separately.'
bd dolt commit -m 'Record completed SDK release readiness'
```

Expected: all three records are closed.

### Task 4: Create open documentation, state-retirement, and CLI work

**Files:**

- Modify through `bd`: `.beads/issues.jsonl`

- [ ] **Step 1: Create the plan-reconciliation task**

Run:

```bash
bd --dolt-auto-commit=batch create \
  --id sdk-plan-reconcile \
  --title 'Reconcile completed SDK plan checklists' \
  --type task \
  --priority P2 \
  --labels docs,maintenance \
  --description 'The Phase 0 reconciliation and release-readiness plans contain unchecked execution steps despite merged completion evidence, making historical text look like active work.' \
  --acceptance 'Both plans have explicit completed and merged status; checkboxes are reconciled only with PR and commit evidence; no unchecked line looks actionable; deliberately unperformed external release operations remain explicit.' \
  --design 'Audit the plans against PRs #9, #11, #22, and #23 plus current main. Update documentation only; do not rewrite history or claim unverified red-green steps.' \
  --spec-id docs/superpowers/specs/2026-08-20-sdk-beads-backlog-design.md
```

Expected: `sdk-plan-reconcile` is open and ready.

- [ ] **Step 2: Create the repository-state retirement epic**

Run:

```bash
bd --dolt-auto-commit=batch create \
  --id sdk-state-retire \
  --title 'Retire superseded SDK repository state safely' \
  --type epic \
  --priority P3 \
  --labels maintenance \
  --description 'Audit and, only after approval, retire legacy SDK branches, worktrees, and the preserved reconciliation stash without losing unique work.' \
  --acceptance 'Every state item has evidence-backed disposition; only approved strict supersets or merged state are removed; the canonical checkout remains clean.' \
  --spec-id docs/superpowers/specs/2026-08-20-sdk-beads-backlog-design.md

bd --dolt-auto-commit=batch create \
  --id sdk-state-audit \
  --parent sdk-state-retire \
  --title 'Audit legacy branches, worktrees, and the preserved stash' \
  --type chore \
  --priority P3 \
  --labels maintenance \
  --description 'Classify every attached worktree, local and remote branch, and stash@{0} as merged, patch-equivalent, superseded, unique, or still needed.' \
  --acceptance 'The audit records exact refs, ancestry or patch-equivalence proof, dirty state, stash comparison, and a proposed keep or retire disposition for every item. No state is deleted.' \
  --notes 'Preserved stash: sdk/cave-o2bqs-post-merge-verifier-isolation-2026-08-18.'

bd --dolt-auto-commit=batch create \
  --id sdk-state-cleanup \
  --parent sdk-state-retire \
  --title 'Retire approved superseded branches, worktrees, and stash state' \
  --type chore \
  --priority P3 \
  --labels maintenance,external-gate \
  --description 'Remove only repository state proven superseded by the audit and explicitly approved by the maintainer.' \
  --acceptance 'Approval is recorded; exact targets are enumerated; recoverability is documented; approved targets are removed; retained targets and the canonical checkout remain clean.' \
  --notes 'Destructive cleanup is not authorized by creating this Bead.'
```

Expected: audit and cleanup children exist under the maintenance epic.

- [ ] **Step 3: Create the CLI scope decision**

Run:

```bash
bd --dolt-auto-commit=batch create \
  --id sdk-cli-scope \
  --title 'Define the operational opencoven CLI scope' \
  --type decision \
  --priority P2 \
  --labels cli \
  --description 'The CLI intentionally returns not_implemented for operational commands; define ownership before creating feature work.' \
  --acceptance 'An approved decision records command surface, package ownership, transport and authentication boundaries, compatibility policy, output contracts, and exact follow-up implementation Beads or an explicit decision to remain help/version only.' \
  --design 'Start from packages/cli/README.md and current deterministic help, version, human-error, and JSON-error contracts. Do not infer daemon discovery or credential ownership.'
```

Expected: `sdk-cli-scope` is open and ready without speculative child features.

- [ ] **Step 4: Wire retirement dependencies and commit the batch**

Run:

```bash
bd --dolt-auto-commit=batch dep add sdk-state-cleanup sdk-state-audit
bd --dolt-auto-commit=batch dep add sdk-state-retire sdk-state-cleanup
bd dolt commit -m 'Add SDK documentation and maintenance backlog'
```

Expected: the audit is ready; cleanup and its parent epic are blocked.

### Task 5: Create the gated first-release program

**Files:**

- Modify through `bd`: `.beads/issues.jsonl`

- [ ] **Step 1: Create the release epic and authorization decision**

Run:

```bash
bd --dolt-auto-commit=batch create \
  --id sdk-first-release \
  --title 'Ship the first public OpenCoven SDK release' \
  --type epic \
  --priority P1 \
  --labels release,security,external-gate \
  --description 'Execute the separately authorized first release using the landed two-key release system, exact verified artifacts, one-time bootstrap, trusted publishing, and provenance validation.' \
  --acceptance 'All gated children close with authorization and audit evidence; five fixed-version packages are validated in the registry; future publishing uses protected OIDC only.' \
  --spec-id docs/superpowers/specs/2026-08-19-sdk-release-readiness-design.md

bd --dolt-auto-commit=batch create \
  --id sdk-release-authorize \
  --parent sdk-first-release \
  --title 'Authorize the first SDK release and target version' \
  --type decision \
  --priority P1 \
  --labels release,external-gate \
  --description 'Decide whether the experimental SDK is approved to publish and define the exact fixed-group version and release scope.' \
  --acceptance 'A maintainer records approve or defer, target version, included package scope, launch criteria, and explicit authority to begin external release preparation. No publication occurs in this decision.' \
  --design 'Current state is version 0.1.0, publishingEnabled false, and all five packages private. Preserve those locks unless this decision explicitly authorizes a reviewed launch change.'
```

Expected: the epic and its first decision exist; the decision is the only ready
release child.

- [ ] **Step 2: Create governance and security gates**

Run:

```bash
bd --dolt-auto-commit=batch create \
  --id sdk-release-governance \
  --parent sdk-first-release \
  --title 'Reconcile SDK release governance prerequisites' \
  --type task \
  --priority P1 \
  --labels release,security,external-gate \
  --description 'Confirm npm ownership, account 2FA, package bootstrap constraints, protected npm-release environment, required checks, and the current branch-protection constraint before unlock.' \
  --acceptance 'Evidence covers npm organization and package-name readiness, least-privilege bootstrap ownership, protected environment reviewers, required checks, and an explicit decision about branch protection. No branch protection or environment is changed without separate approval.' \
  --design 'RELEASING.md requires a protected npm-release environment. Prior maintainer direction leaves branch protection untouched unless separately authorized.'

bd --dolt-auto-commit=batch create \
  --id sdk-release-security \
  --parent sdk-first-release \
  --title 'Complete the first-release security review' \
  --type task \
  --priority P1 \
  --labels release,security \
  --description 'Review package APIs, release scripts and workflows, dependency findings, secret handling, provenance, and the documented experimental boundary before publication unlock.' \
  --acceptance 'The review records scope, threat boundaries, automated and manual evidence, all findings with disposition, and an explicit ship or block recommendation.' \
  --design 'Treat current zero CodeQL and Dependabot alerts as inputs, not a substitute for release-scope review.'
```

Expected: two open gates exist beneath the release epic.

- [ ] **Step 3: Create launch, rehearsal, and bootstrap tasks**

Run:

```bash
bd --dolt-auto-commit=batch create \
  --id sdk-release-unlock \
  --parent sdk-first-release \
  --title 'Prepare the reviewed SDK launch and publication-unlock change' \
  --type feature \
  --priority P1 \
  --labels release,security \
  --description 'Prepare a reviewed release branch that versions the fixed group, updates changelogs and internal ranges, opens repository publication locks, and preserves the protected environment gate.' \
  --acceptance 'Canonical verification passes in a clean checkout; version and ranges are exact; publish mode still requires the protected environment; a PR is reviewed and merged without direct push to main.' \
  --design 'Use Changesets and the existing release contract. Do not create credentials, tags, or registry records in this task.'

bd --dolt-auto-commit=batch create \
  --id sdk-release-rehearsal \
  --parent sdk-first-release \
  --title 'Tag the reviewed commit and run verify-mode artifacts' \
  --type task \
  --priority P1 \
  --labels release,external-gate \
  --description 'Create the annotated sdk-v<version> tag from the exact reviewed main commit and run release workflow verify mode without publishing.' \
  --acceptance 'The tag resolves to reviewed HEAD; five tarballs, release-manifest.json, checksums, and attestations are retained; every digest and package contract passes; registry state is unchanged.'

bd --dolt-auto-commit=batch create \
  --id sdk-release-bootstrap \
  --parent sdk-first-release \
  --title 'Perform the one-time SDK npm bootstrap publication' \
  --type task \
  --priority P1 \
  --labels release,security,external-gate \
  --description 'Publish the exact verified tarballs in canonical order with an explicitly approved least-privilege bootstrap credential, then revoke it.' \
  --acceptance 'All five package records and expected versions exist; bytes and ownership match the verified artifacts; the credential is revoked; no token is stored in GitHub, repository files, or shell history; the audit trail is recorded.' \
  --design 'This external mutation requires fresh explicit authorization at execution time even after its dependency chain is clear.'
```

Expected: launch, rehearsal, and bootstrap records exist but are blocked after
dependency wiring.

- [ ] **Step 4: Create trusted-publisher and validation tasks**

Run:

```bash
bd --dolt-auto-commit=batch create \
  --id sdk-release-trusted \
  --parent sdk-first-release \
  --title 'Configure trusted publishing for all SDK packages' \
  --type task \
  --priority P1 \
  --labels release,security,external-gate \
  --description 'Bind all five npm packages to OpenCoven/sdk, the exact release workflow, and the protected npm-release environment.' \
  --acceptance 'Every package has the expected trusted-publisher identity; normal workflow publication uses OIDC; NPM_TOKEN and NODE_AUTH_TOKEN fallback remain absent.'

bd --dolt-auto-commit=batch create \
  --id sdk-release-validate \
  --parent sdk-first-release \
  --title 'Validate SDK registry state, provenance, and OIDC readiness' \
  --type task \
  --priority P1 \
  --labels release,security \
  --description 'Verify the published fixed group and preserve evidence that future releases can use the protected OIDC path.' \
  --acceptance 'Versions, latest dist-tags, manifests, licenses, changelogs, binaries, internal ranges, checksums, npm provenance, GitHub attestations, and clean consumer imports all match the release record.'
```

Expected: the final two release children exist.

- [ ] **Step 5: Wire the release dependency chain**

Run:

```bash
bd --dolt-auto-commit=batch dep add sdk-release-governance sdk-release-authorize
bd --dolt-auto-commit=batch dep add sdk-release-security sdk-release-governance
bd --dolt-auto-commit=batch dep add sdk-release-unlock sdk-release-security
bd --dolt-auto-commit=batch dep add sdk-release-rehearsal sdk-release-unlock
bd --dolt-auto-commit=batch dep add sdk-release-bootstrap sdk-release-rehearsal
bd --dolt-auto-commit=batch dep add sdk-release-trusted sdk-release-bootstrap
bd --dolt-auto-commit=batch dep add sdk-release-validate sdk-release-trusted
bd --dolt-auto-commit=batch dep add sdk-first-release sdk-release-validate
bd dolt commit -m 'Add gated SDK first-release program'
```

Expected: one linear child gate chain; the parent epic depends on final
validation and does not appear ready.

### Task 6: Validate the Beads graph and exported ledger

**Files:**

- Create: `.beads/issues.jsonl`
- Modify: `.beads/config.yaml`

- [ ] **Step 1: Check database identity and configuration**

Run:

```bash
bd context
bd config get export.auto
bd config get export.path
bd dolt status
```

Expected: SDK context, prefix/database `sdk`, export enabled to `issues.jsonl`,
and a healthy embedded Dolt backend.

- [ ] **Step 2: Check issue counts and statuses**

Run:

```bash
bd list --all --json | jq '{total:length, by_status:(group_by(.status)|map({status:.[0].status,count:length})), by_type:(group_by(.issue_type)|map({type:.[0].issue_type,count:length}))}'
```

Expected: 20 records total: 6 closed and 14 open. Expected types are 4 epics,
1 feature, 2 decisions, 10 tasks, and 3 chores.

- [ ] **Step 3: Check the ready queue exactly**

Run:

```bash
bd ready --json | jq 'map(.id) | sort'
```

Expected:

```json
[
  "sdk-cli-scope",
  "sdk-plan-reconcile",
  "sdk-release-authorize",
  "sdk-state-audit"
]
```

- [ ] **Step 4: Check blocked work and dependency shape**

Run:

```bash
bd blocked --json | jq 'map(.id) | sort'
bd dep tree sdk-state-retire --direction=down
bd dep tree sdk-first-release --direction=down
bd dep cycles
```

Expected blocked IDs:

```json
[
  "sdk-first-release",
  "sdk-release-bootstrap",
  "sdk-release-governance",
  "sdk-release-rehearsal",
  "sdk-release-security",
  "sdk-release-trusted",
  "sdk-release-unlock",
  "sdk-release-validate",
  "sdk-state-cleanup",
  "sdk-state-retire"
]
```

Expected: the two trees reflect the designed ordering and `bd dep cycles`
reports no cycles.

- [ ] **Step 5: Export and inspect the issue ledger**

Run:

```bash
bd export --output .beads/issues.jsonl
wc -l .beads/issues.jsonl
jq -s '{total:length, ids:(map(.id)|sort), duplicate_ids:(group_by(.id)|map(select(length>1)|.[0].id))}' .beads/issues.jsonl
```

Expected: 20 JSONL lines, 20 unique stable IDs, and `duplicate_ids: []`.

### Task 7: Verify SDK integrity and commit the constructed backlog

**Files:**

- Stage only: `.beads/.gitignore`
- Stage only: `.beads/README.md`
- Stage only: `.beads/config.yaml`
- Stage only: `.beads/interactions.jsonl`
- Stage only: `.beads/issues.jsonl`
- Stage only: `.beads/metadata.json`
- Stage only: `.gitignore`

- [ ] **Step 1: Inspect tracked and ignored Beads state**

Run:

```bash
git status --short
git check-ignore -v .beads/embeddeddolt .beads/.local_version
git diff -- .beads/config.yaml .gitignore
git diff --check
```

Expected: only repository-owned Beads metadata/export files are uncommitted;
Dolt runtime and local-version files are ignored; no whitespace errors exist.

- [ ] **Step 2: Run the full SDK verifier**

Run:

```bash
corepack pnpm@10.34.0 verify
```

Expected: typecheck, 246 unit tests, builds, contract verification, packed
package checks, release readiness, coverage, all three stress seeds, and lint
pass. Record actual counts if the suite has legitimately changed.

- [ ] **Step 3: Stage only the Beads project files**

Run:

```bash
git add -- \
  .beads/.gitignore \
  .beads/README.md \
  .beads/config.yaml \
  .beads/interactions.jsonl \
  .beads/issues.jsonl \
  .beads/metadata.json \
  .gitignore
git diff --cached --check
git diff --cached --stat
git diff --cached --name-only
```

Expected: only the seven named project files are staged. Some initialization
files may already be committed by `bd init`; staged output may therefore be a
smaller subset, but it must never include Dolt runtime data or unrelated files.

- [ ] **Step 4: Commit the verified issue graph**

Run:

```bash
git commit -m 'chore: construct SDK Beads backlog'
```

Expected: pre-commit secret and private-key hooks pass and the issue-ledger
commit is created. If no Git changes remain because the installed `bd` version
committed them automatically, do not create an empty commit.

- [ ] **Step 5: Run final read-only verification**

Run:

```bash
git status --short --branch
git log --oneline --decorate -4
bd list --all --json | jq 'length'
bd ready --json | jq 'map(.id) | sort'
bd blocked --json | jq 'map(.id) | sort'
bd dep cycles
bd export | wc -l
```

Expected: clean feature branch, 20 records, exactly four ready IDs, exactly ten
blocked IDs, no dependency cycles, and 20 exported issue records. Do not push or
open a PR without separate authorization.
