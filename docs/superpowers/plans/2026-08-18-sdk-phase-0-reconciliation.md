# SDK Phase 0 Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the SDK Phase 0 feature and review branches into current `main`, preserve both lines' guarantees, and publish a fully verified pull request with clear Beads evidence.

**Architecture:** Work only in `fix/cave-o2bqs-sdk-reconciliation`, based on current `origin/main`. Merge the feature history first, then the review history; resolve every conflict semantically using the existing tests as executable contracts, without rewriting either source branch.

**Tech Stack:** Git merge commits, Beads 1.0.5, Node 24.18.x, pnpm 10.34.0, TypeScript 6.0.3, Vitest 4.1.10, ESLint 10, tsup 8.5.1, GitHub CLI.

---

## Source Heads

- Current base: `origin/main` at `c5fcfa0`
- Feature line: `feat/cave-o2bqs-sdk-foundation` at `95d2436`
- Review line: `fix/cave-o2bqs-sdk-review` at `2d8d1c7`
- Common feature/review base: `57e5cbc`
- Integration worktree:
  `/Users/buns/Documents/GitHub/OpenCoven/sdk/.worktrees/cave-o2bqs-reconciliation`

## Conflict File Map

### Current Main and Feature Merge

- `.github/workflows/ci.yml`: retain pinned actions, install, build-before-lint,
  lint, typecheck, tests, contract verification, and packed-package verification.
- `README.md`: retain the full Phase 0 package/fixture documentation and current
  experimental-security guidance.
- `package.json`: retain the five-package/three-example build, make `verify`
  build before lint/typecheck, and keep current security/tooling dependencies.
- `scripts/owned-temp-directory.d.mts`: retain the feature line's complete
  cross-platform owned-temp types.
- `scripts/owned-temp-directory.mjs`: retain the feature line's Linux inode
  reuse defense, real-OS-temp containment, identity checks, and safe cleanup.
- `scripts/package-artifacts.mjs`: retain owned artifact-root creation and
  cleanup without offline network assumptions.
- `scripts/verify-package.mjs`: combine current security helper declarations
  with feature packed-package/source-exclusion verification.
- `tests/pack-public-packages-artifact-paths.spec.ts`: retain all path,
  permissions, inode-reuse, and symlink-cleanup cases.
- `tests/packed-package.spec.ts`: retain current security assertions and feature
  packed-install checks.
- `tests/workflow-pins.spec.ts`: retain full-SHA action pinning and release
  comments.

### Feature and Review Merge

- `LICENSE`: use `AGPL-3.0-only OR MIT`.
- `package.json`: use `AGPL-3.0-only OR MIT`, keep build-before-lint, root
  typechecking, and Vitest workspace support.
- `packages/{core,cave,coven,sdk,cli}/package.json`: use the approved SPDX
  expression and preserve declared entry points, files, exports, and the CLI's
  sole `opencoven` binary ownership.
- `packages/{cave,coven}/README.md`: retain transport constraints and add the
  approved license expression.
- `packages/{cave,coven}/src/client.ts`: preserve feature health negotiation and
  add review-enforced `invalid_response` normalized errors for malformed
  authority payloads.
- `packages/{core,sdk}/README.md`: retain package purpose and approved license
  expression after the automatic merge.
- `scripts/verify-package.mjs`: verify every installed package, including
  `@opencoven/sdk`, while retaining current security/path checks.
- `tests/package-manifests.spec.ts`: require the approved SPDX expression and
  package metadata.
- `tests/packed-package.spec.ts`: preserve both packed-install behavior and
  review source-exclusion assertions.
- Keep review-added files:
  - `tests/cli-binary.spec.ts`
  - `tests/client-contract.spec.ts`
  - `tests/review-corrections.spec.ts`
  - `tests/verify-package-contract.spec.ts`
  - `tests/workspace-contract.spec.ts`
  - `tsconfig.eslint.json`
  - `vitest.workspace.ts`

## Task 1: Confirm the Isolated Baseline and Bead Ownership

**Files:** None.

- [ ] **Step 1: Confirm the integration worktree is clean**

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/sdk/.worktrees/cave-o2bqs-reconciliation
git status --short --branch
git rev-parse HEAD
```

Expected: clean `fix/cave-o2bqs-sdk-reconciliation` at or ahead of `c5fcfa0`
only by the committed design and plan documents.

- [ ] **Step 2: Confirm the exact source heads**

```bash
git rev-parse feat/cave-o2bqs-sdk-foundation
git rev-parse fix/cave-o2bqs-sdk-review
```

Expected:

```text
95d24367ef0f8f4d26758ea476d9a0e0aa9e36a2
2d8d1c795cbd1ba0bb490b856ed66c5f803855d1
```

- [ ] **Step 3: Read the Bead before changing code**

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave
bd show cave-o2bqs
```

Expected: the bead remains assigned to Val Alexander and records the two
passing but divergent branches.

## Task 2: Merge Current Main with the Feature Line

**Files:** Current-main/feature conflict files from the File Map.

- [ ] **Step 1: Merge the feature history**

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/sdk/.worktrees/cave-o2bqs-reconciliation
git merge --no-ff feat/cave-o2bqs-sdk-foundation
```

Expected: Git reports add/add conflicts in the ten files listed under
"Current Main and Feature Merge".

- [ ] **Step 2: Resolve CI, documentation, and root manifest conflicts**

Resolve:

```text
.github/workflows/ci.yml
README.md
package.json
```

Required resulting behavior:

```json
{
  "license": "AGPL-3.0-or-later OR MIT",
  "scripts": {
    "build": "corepack pnpm@10.34.0 --recursive --filter './packages/*' build && corepack pnpm@10.34.0 --recursive --filter './examples/*' build",
    "verify": "corepack pnpm@10.34.0 build && corepack pnpm@10.34.0 lint && corepack pnpm@10.34.0 typecheck && corepack pnpm@10.34.0 test && corepack pnpm@10.34.0 verify:contracts && corepack pnpm@10.34.0 verify:package"
  }
}
```

The SPDX expression changes to `AGPL-3.0-only OR MIT` in Task 4 when the review
line is merged. The CI workflow must run install, build, lint, typecheck, test,
contract verification, and packed-package verification with all actions pinned
to full commit SHAs.

- [ ] **Step 3: Resolve owned-temp and artifact conflicts**

Resolve:

```text
scripts/owned-temp-directory.d.mts
scripts/owned-temp-directory.mjs
scripts/package-artifacts.mjs
```

Preserve these exported interfaces:

```ts
export type OwnedTempDirectory = {
  rootPath: string;
  path: string;
  rootDevice: number;
  rootInode: number;
  rootRealPath: string;
  rootMarker: string;
};
```

The implementation must reject unsafe child segments, create mode-0700
directories beneath the real OS temporary directory, detect identity changes
even when Linux reuses an inode, and remove nested symlinks without following
them.

- [ ] **Step 4: Resolve package-verification and test conflicts**

Resolve:

```text
scripts/verify-package.mjs
tests/pack-public-packages-artifact-paths.spec.ts
tests/packed-package.spec.ts
tests/workflow-pins.spec.ts
```

Retain every assertion from both sides. Do not weaken a test to make the merge
pass.

- [ ] **Step 5: Confirm all conflict markers are gone**

```bash
git diff --name-only --diff-filter=U
rg '^(<<<<<<<|=======|>>>>>>>)' .
```

Expected: both commands produce no conflict paths or markers.

- [ ] **Step 6: Run the first-merge focused tests**

```bash
corepack pnpm@10.34.0 install --frozen-lockfile
corepack pnpm@10.34.0 exec vitest run \
  tests/pack-public-packages-artifact-paths.spec.ts \
  tests/packed-package.spec.ts \
  tests/workflow-pins.spec.ts
```

Expected: all focused tests pass.

- [ ] **Step 7: Complete the feature merge commit**

```bash
git add .github/workflows/ci.yml README.md package.json \
  scripts/owned-temp-directory.d.mts scripts/owned-temp-directory.mjs \
  scripts/package-artifacts.mjs scripts/verify-package.mjs \
  tests/pack-public-packages-artifact-paths.spec.ts \
  tests/packed-package.spec.ts tests/workflow-pins.spec.ts
git commit
```

Keep Git's merge message and append:

```text
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## Task 3: Add a First-Merge Regression Check

**Files:**
- Modify: `tests/pack-public-packages-artifact-paths.spec.ts`
- Modify: `tests/packed-package.spec.ts`

- [ ] **Step 1: Confirm the combined tests cover both branch guarantees**

The artifact-path suite must contain assertions equivalent to:

```ts
expect(realpathSync(outputDirectory.rootPath).startsWith(realpathSync(tmpdir()))).toBe(true);
expect(lstatSync(outputDirectory.rootPath).mode & 0o777).toBe(0o700);
expect(() => cleanupOwnedTempRoot(withReusedInode)).toThrow(/changed identity/);
expect(readFileSync(resolve(externalRoot, 'outside.txt'), 'utf8')).toBe('outside\n');
```

The packed-package suite must install tarballs without source-relative links
and reject undeclared source files.

- [ ] **Step 2: Add only a missing reconciliation assertion**

If either guarantee is absent after conflict resolution, add the exact missing
assertion to the existing suite. If all guarantees are already present, make no
test edit.

- [ ] **Step 3: Re-run the focused tests**

```bash
corepack pnpm@10.34.0 exec vitest run \
  tests/pack-public-packages-artifact-paths.spec.ts \
  tests/packed-package.spec.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit only if Task 3 changed tests**

```bash
git add tests/pack-public-packages-artifact-paths.spec.ts \
  tests/packed-package.spec.ts
git diff --cached --quiet || git commit \
  -m "test: preserve SDK packaging merge guarantees" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 4: Merge the Review Line

**Files:** Feature/review conflict files from the File Map.

- [ ] **Step 1: Merge the review history**

```bash
git merge --no-ff fix/cave-o2bqs-sdk-review
```

Expected: Git reports conflicts in the eleven files listed under
"Feature and Review Merge".

- [ ] **Step 2: Resolve licensing and workspace conflicts**

Resolve:

```text
LICENSE
package.json
packages/cave/package.json
packages/cli/package.json
packages/core/package.json
packages/coven/package.json
packages/sdk/package.json
packages/cave/README.md
packages/coven/README.md
```

Use this exact SPDX expression in all manifests and package documentation:

```text
AGPL-3.0-only OR MIT
```

Keep the build-before-lint `verify` command from Task 2 and retain
`vitest.workspace.ts`, root TypeScript checking, declared package exports,
published file lists, and sole CLI binary ownership.

- [ ] **Step 3: Resolve Cave and Coven client conflicts**

Resolve:

```text
packages/cave/src/client.ts
packages/coven/src/client.ts
```

Preserve caller-supplied constrained transports and ensure malformed health
responses reject with:

```ts
{
  normalized: {
    system: 'cave' | 'coven',
    code: 'invalid_response',
    retryable: false,
    operation: 'health',
  },
}
```

Do not add discovery, direct network calls, environment reads, filesystem reads,
or import-time I/O.

- [ ] **Step 4: Resolve package verifier conflicts**

Resolve `scripts/verify-package.mjs` so its installed package map includes:

```js
const installedPackageDirectories = {
  core: 'core',
  cave: 'cave',
  coven: 'coven',
  sdk: 'sdk',
  cli: 'cli',
};
```

Apply source-exclusion verification uniformly to every installed public
package. Retain owned artifact cleanup and current security/path guards.

- [ ] **Step 5: Preserve all review contract files**

Confirm these files exist unchanged unless conflict resolution requires an
import/path correction:

```text
tests/cli-binary.spec.ts
tests/client-contract.spec.ts
tests/review-corrections.spec.ts
tests/verify-package-contract.spec.ts
tests/workspace-contract.spec.ts
tsconfig.eslint.json
vitest.workspace.ts
```

- [ ] **Step 6: Confirm the second merge is fully resolved**

```bash
git diff --name-only --diff-filter=U
rg '^(<<<<<<<|=======|>>>>>>>)' .
```

Expected: no output.

- [ ] **Step 7: Run review and overlap tests**

```bash
corepack pnpm@10.34.0 exec vitest run \
  tests/cli-binary.spec.ts \
  tests/client-contract.spec.ts \
  tests/package-manifests.spec.ts \
  tests/packed-package.spec.ts \
  tests/review-corrections.spec.ts \
  tests/verify-package-contract.spec.ts \
  tests/workspace-contract.spec.ts \
  tests/pack-public-packages-artifact-paths.spec.ts \
  tests/workflow-pins.spec.ts
```

Expected: all focused suites pass.

- [ ] **Step 8: Complete the review merge commit**

```bash
git add LICENSE package.json packages scripts/verify-package.mjs tests \
  tsconfig.eslint.json tsconfig.json vitest.config.ts vitest.workspace.ts
git commit
```

Keep Git's merge message and append:

```text
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## Task 5: Verify the Reconciled SDK

**Files:** None unless verification identifies a reconciliation defect.

- [ ] **Step 1: Run the full repository gate**

```bash
corepack pnpm@10.34.0 verify
```

Expected:

- five packages and three examples build;
- lint and typecheck pass;
- all merged Vitest suites pass;
- contract fixtures verify;
- all five public packages pack, install, and pass source-exclusion checks.

- [ ] **Step 2: Check formatting, conflicts, and generated cleanliness**

```bash
git diff --check
rg '^(<<<<<<<|=======|>>>>>>>)' .
git status --short
```

Expected: no whitespace errors, conflict markers, generated artifacts, or
untracked verification output.

- [ ] **Step 3: Review the combined history and scope**

```bash
git --no-pager log --graph --oneline --decorate origin/main..HEAD
git --no-pager diff --stat origin/main...HEAD
git merge-base --is-ancestor 95d2436 HEAD
git merge-base --is-ancestor 2d8d1c7 HEAD
```

Expected: both ancestry checks succeed and the diff contains only Phase 0 SDK,
documentation, tests, and reconciliation artifacts.

- [ ] **Step 4: Run the repository secret hooks on the final staged state**

```bash
git add -A
pre-commit run --all-files
git reset
```

Expected: hardcoded-secret and private-key checks pass. `git reset` only
unstages the inspection set; it must not discard files.

## Task 6: Record Evidence, Publish the PR, and Comment Naturally

**Files:** None.

- [ ] **Step 1: Append complete Beads evidence**

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave
bd update cave-o2bqs --append-notes 'Reconciliation branch fix/cave-o2bqs-sdk-reconciliation merges feature head 95d2436 and review head 2d8d1c7 into current SDK main. Record the resolved conflict files, focused test counts, full verify result, secret-hook result, final SDK commit, and PR URL here before requesting closure.'
```

- [ ] **Step 2: Push the integration branch**

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/sdk/.worktrees/cave-o2bqs-reconciliation
git push -u origin fix/cave-o2bqs-sdk-reconciliation
```

Expected: the branch is published without force.

- [ ] **Step 3: Open the pull request**

```bash
gh pr create \
  --repo OpenCoven/sdk \
  --base main \
  --head fix/cave-o2bqs-sdk-reconciliation \
  --title "Reconcile the Phase 0 SDK implementation lines" \
  --body '## Summary

- merge the later Phase 0 packaging, CI, fixture, and cross-platform hardening
- merge the stricter workspace, licensing, client-error, CLI, and package-verification review fixes
- preserve both source histories without rewriting either branch

## Verification

- focused conflict-area Vitest suites
- `corepack pnpm@10.34.0 verify`
- `pre-commit run --all-files`

## Beads

- `cave-o2bqs`'
```

The PR body must contain:

```markdown
## Summary

- merge the later Phase 0 packaging, CI, fixture, and cross-platform hardening
- merge the stricter workspace, licensing, client-error, CLI, and package-verification review fixes
- preserve both source histories without rewriting either branch

## Verification

- focused conflict-area Vitest suites
- `corepack pnpm@10.34.0 verify`
- `pre-commit run --all-files`

## Beads

- `cave-o2bqs`
```

- [ ] **Step 4: Post the public note-to-self**

```bash
gh pr comment fix/cave-o2bqs-sdk-reconciliation \
  --repo OpenCoven/sdk \
  --body 'Leaving myself a note here: both branches were green, but they had evolved independently. This PR combines the stricter review fixes with the later packaging, CI, and cross-platform hardening instead of treating either line as disposable. The conflict resolutions are intended to preserve both sets of guarantees; the verification notes below are the checklist for confirming that.'
```

Expected: the comment appears once on the reconciliation PR and reads naturally
as the user's public note to self.

- [ ] **Step 5: Update Beads with the published evidence**

Append the PR URL, final commit SHA, exact focused/full verification results,
security result, and clean status to `cave-o2bqs`. Do not close
`cave-u0oli`; it remains blocked until the SDK bead is reviewed and closed.
