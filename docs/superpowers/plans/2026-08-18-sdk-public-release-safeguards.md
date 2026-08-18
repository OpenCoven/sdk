# SDK Public Release Safeguards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the open CodeQL and Dependabot findings, prevent accidental npm publication, and make the local lint command respect nested SDK worktrees.

**Architecture:** Keep enforcement close to its owner: GitHub Actions declares its token permissions, pnpm owns the transitive dependency override, package manifests and a lifecycle script own publication control, and ESLint owns its filesystem boundary. Static regression tests preserve the workflow, manifest, and lint-boundary contracts without changing product runtime code.

**Tech Stack:** GitHub Actions YAML, pnpm 10, npm lifecycle scripts, ESLint flat config, TypeScript, Vitest.

---

### Task 1: Close GitHub security findings

**Files:**
- Modify: `.github/workflows/ci.yml:10`
- Modify: `package.json:13`
- Modify: `pnpm-lock.yaml:7`
- Test: `tests/workflow-pins.spec.ts`
- Test: `tests/package-manifests.spec.ts`

- [ ] **Step 1: Write failing regression assertions**

```ts
expect(workflow).toMatch(/^permissions:\n\s{2}contents: read\n/m);
expect(rootManifest.pnpm?.overrides?.esbuild).toBe('0.28.1');
```

- [ ] **Step 2: Run the focused tests and confirm the missing permission and override fail**

Run: `pnpm vitest run tests/workflow-pins.spec.ts tests/package-manifests.spec.ts`

Expected: FAIL because `permissions` and `pnpm.overrides.esbuild` are absent.

- [ ] **Step 3: Add the minimal security configuration**

```yaml
permissions:
  contents: read
```

```json
"pnpm": {
  "overrides": {
    "esbuild": "0.28.1"
  }
}
```

Run `pnpm install --lockfile-only` to regenerate `pnpm-lock.yaml` with the patched `esbuild` tree.

- [ ] **Step 4: Confirm the dependency and tests are green**

Run: `pnpm why esbuild && pnpm audit --json && pnpm vitest run tests/workflow-pins.spec.ts tests/package-manifests.spec.ts`

Expected: `esbuild@0.28.1`, zero audit vulnerabilities, and both test files pass.

### Task 2: Block accidental npm publication

**Files:**
- Create: `scripts/require-release-authorization.mjs`
- Modify: `packages/cave/package.json`
- Modify: `packages/cli/package.json`
- Modify: `packages/core/package.json`
- Modify: `packages/coven/package.json`
- Modify: `packages/sdk/package.json`
- Modify: `README.md:4`
- Test: `tests/package-manifests.spec.ts`

- [ ] **Step 1: Write the failing package-manifest assertion**

```ts
expect(manifest.private).toBe(true);
expect(manifest.scripts?.prepublishOnly).toBe(
  'node ../../scripts/require-release-authorization.mjs',
);
```

- [ ] **Step 2: Run the manifest test and confirm it fails**

Run: `pnpm vitest run tests/package-manifests.spec.ts`

Expected: FAIL because packages lack the release lifecycle script.

- [ ] **Step 3: Add the release authorization script and package hooks**

```js
if (process.env.OPENCOVEN_RELEASE_AUTHORIZATION !== 'publish') {
  console.error('Publishing is disabled until release approval. Set OPENCOVEN_RELEASE_AUTHORIZATION=publish as part of the release process.');
  process.exit(1);
}
```

Add `"private": true` and the `prepublishOnly` command to every package manifest. Document that release work must intentionally remove/change the private gate and provide the named authorization.

- [ ] **Step 4: Prove the standard publish path is blocked**

Run: `npm publish --dry-run`

Working directory: `packages/cave`

Expected: exit 1 from `prepublishOnly` before any registry action.

### Task 3: Make lint honor the existing nested-worktree boundary

**Files:**
- Modify: `eslint.config.mjs:6`
- Create: `tests/lint-boundaries.spec.ts`

- [ ] **Step 1: Write a failing ESLint-boundary test**

```ts
const config = readFileSync(resolve(root, 'eslint.config.mjs'), 'utf8');
expect(config).toContain("'.worktrees/**'");
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run tests/lint-boundaries.spec.ts`

Expected: FAIL because ESLint ignores generated output but not `.worktrees`.

- [ ] **Step 3: Add the narrow ESLint ignore**

```js
ignores: [
  '**/dist/**',
  '**/node_modules/**',
  '.artifacts/**',
  'coverage/**',
  '.worktrees/**',
  '**/tsup.config.ts',
],
```

- [ ] **Step 4: Prove both the regression and full lint pass**

Run: `pnpm vitest run tests/lint-boundaries.spec.ts && pnpm lint`

Expected: both commands exit 0; files inside nested worktrees are not inspected.

### Task 4: Complete clean-checkout-equivalent verification

**Files:**
- Verify only: no additional source changes

- [ ] **Step 1: Run the complete validation suite**

Run: `pnpm verify && pre-commit run --all-files && gitleaks git . --no-banner --redact && git diff --check`

Expected: all commands exit 0, package verification packs each SDK package successfully, and Gitleaks finds no leaks.

- [ ] **Step 2: Recheck hosted findings after the patch is committed and pushed**

Run: `gh api 'repos/OpenCoven/sdk/code-scanning/alerts?state=open&per_page=100' --jq 'length' && gh api 'repos/OpenCoven/sdk/dependabot/alerts?state=open&per_page=100' --jq 'length'`

Expected: both counts are `0` after GitHub processes the new workflow and lockfile.

- [ ] **Step 3: Stop before commit or push unless explicitly requested**

The current request authorizes the patch and verification only. Do not create a commit or alter branch protection without a separate explicit instruction.
