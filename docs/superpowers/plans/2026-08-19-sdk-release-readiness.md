# SDK Release Readiness Implementation Plan

> **Historical scope note:** This completed plan originally established a
> five-package release pipeline. SDK #37 later narrowed the active 0.1 release
> inventory to four packages and retained `@opencoven/dev-cli` as a private
> workspace. See
> [`2026-08-22-sdk-0.1-delivery-program.md`](2026-08-22-sdk-0.1-delivery-program.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete, fail-closed release system for the fixed-version OpenCoven SDK packages while keeping npm publication disabled until a separately approved launch.

**Architecture:** A root release contract and network-free verifier own release invariants; Changesets owns fixed-version changelogs; existing package packing utilities produce checksummed release bundles; GitHub Actions verifies and attests exact artifacts with publish permissions isolated to a protected environment. Repository and deployment locks must both be removed before publication can occur.

**Tech Stack:** Node.js 24 ESM scripts, pnpm 10.34.0, Changesets 3.0.1, Vitest 4, GitHub Actions, npm trusted publishing/OIDC, GitHub artifact attestations.

---

## File Map

### Release contract and versioning

- Create: `release.config.json` — machine-readable support, package, tag, environment, and publication-lock contract.
- Create: `.changeset/config.json` — fixed-version Changesets configuration.
- Create: `.changeset/README.md` — contributor-facing changeset instructions.
- Create: `packages/*/CHANGELOG.md` — per-package release history.
- Modify: `packages/*/package.json` — include changelogs in tarballs.
- Modify: `package.json` — Changesets dependency and release commands.
- Modify: `pnpm-lock.yaml` — lock Changesets and its dependencies.

### Verification and artifact construction

- Create: `scripts/release-readiness.mjs` — reusable config/manifest validation functions.
- Create: `scripts/verify-release-readiness.mjs` — CLI wrapper used locally and in CI.
- Create: `scripts/create-release-artifacts.mjs` — pack public packages and write checksummed release manifest.
- Create: `scripts/publish-release-artifacts.mjs` — verify exact tarballs and invoke npm only after every release gate passes.
- Modify: `scripts/repository-metadata.mjs` — export the canonical package order for release tooling if needed.

### Automation and policy

- Modify: `.github/workflows/ci.yml` — test Node 24 floor and latest patch.
- Create: `.github/workflows/release.yml` — manual verify/publish workflow with protected permissions.
- Modify: `.github/dependabot.yml` — valid pnpm/npm and GitHub Actions updates.
- Create: `SUPPORT.md` — supported versions, channels, and scope.
- Create: `SECURITY.md` — vulnerability reporting and supported versions.
- Create: `RELEASING.md` — bootstrap, regular release, provenance, rollback, and incident runbook.
- Modify: `README.md` — link release policies and retain experimental/private status.

### Tests

- Create: `tests/release-readiness.spec.ts` — release config, manifest, lock, version, tag, and publish-command tests.
- Create: `tests/release-artifacts.spec.ts` — deterministic checksums, ordering, cleanup, and tamper rejection.
- Modify: `tests/package-manifests.spec.ts` — Changesets, changelog inclusion, release scripts, engine consistency.
- Modify: `tests/workflow-pins.spec.ts` — Node matrix, release workflow pins, permissions, environment, and token absence.
- Create: `tests/dependabot-config.spec.ts` — valid ecosystems and weekly schedules.
- Modify: `tests/packed-package.spec.ts` — changelog and release-manifest packed assertions.

## Task 1: Add Fixed-Version Changesets and Package Changelogs

**Files:**
- Create: `.changeset/config.json`
- Create: `.changeset/README.md`
- Create: `packages/core/CHANGELOG.md`
- Create: `packages/cave/CHANGELOG.md`
- Create: `packages/coven/CHANGELOG.md`
- Create: `packages/sdk/CHANGELOG.md`
- Create: `packages/cli/CHANGELOG.md`
- Modify: `packages/core/package.json`
- Modify: `packages/cave/package.json`
- Modify: `packages/coven/package.json`
- Modify: `packages/sdk/package.json`
- Modify: `packages/cli/package.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `tests/package-manifests.spec.ts`

- [ ] **Step 1: Add failing manifest assertions**

Add assertions that root scripts and every public package expose the versioning contract:

```ts
expect(rootManifest.devDependencies?.['@changesets/cli']).toBe('3.0.1');
expect(rootManifest.scripts?.changeset).toBe('changeset');
expect(rootManifest.scripts?.['release:status']).toBe('changeset status');
expect(rootManifest.scripts?.['release:version']).toBe('changeset version');

for (const { manifestPath, workspaceDirectory } of PUBLIC_PACKAGES) {
  const manifest = JSON.parse(
    readFileSync(resolve(workspaceRoot, manifestPath), 'utf8'),
  ) as { files?: string[] };

  expect(manifest.files).toContain('CHANGELOG.md');
  expect(
    readFileSync(
      resolve(workspaceRoot, 'packages', workspaceDirectory, 'CHANGELOG.md'),
      'utf8',
    ),
  ).toContain('## 0.1.0');
}
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
corepack pnpm@10.34.0 vitest run tests/package-manifests.spec.ts
```

Expected: FAIL because Changesets, release scripts, and changelogs are absent.

- [ ] **Step 3: Install Changesets**

Run:

```bash
corepack pnpm@10.34.0 add -D -w @changesets/cli@3.0.1
```

Expected: `package.json` and `pnpm-lock.yaml` record exactly `3.0.1`.

- [ ] **Step 4: Add the fixed-group configuration**

Create `.changeset/config.json`:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@4.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [
    [
      "@opencoven/sdk-core",
      "@opencoven/cave-client",
      "@opencoven/coven-client",
      "@opencoven/sdk",
      "@opencoven/dev-cli"
    ]
  ],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": [],
  "privatePackages": {
    "version": true,
    "tag": false
  }
}
```

Create `.changeset/README.md` with these exact rules:

````md
# Changesets

Add a changeset for every user-visible package change:

```bash
corepack pnpm@10.34.0 changeset
```

All five public packages use one fixed version. Choose:

- `patch` for compatible fixes and additive implementation changes;
- `minor` for pre-1.0 breaking changes or substantial new public APIs;
- `major` only after the project reaches 1.0.

Documentation-only, test-only, and repository-maintenance changes need no
changeset unless they alter a published package.
````

- [ ] **Step 5: Add release scripts and initial changelogs**

Add to root `scripts`:

```json
"changeset": "changeset",
"release:status": "changeset status",
"release:version": "changeset version"
```

Create each package changelog using its package name:

```md
# @opencoven/sdk-core

## 0.1.0

- Initial experimental SDK foundation. This version is not yet published.
```

Use the corresponding package name in the other four files. Add
`"CHANGELOG.md"` to every package's `files` array immediately after
`"README.md"`.

- [ ] **Step 6: Run the focused tests and Changesets status**

Run:

```bash
corepack pnpm@10.34.0 vitest run tests/package-manifests.spec.ts
corepack pnpm@10.34.0 release:status
```

Expected: manifest tests pass; Changesets reports no pending release changes
without modifying package versions.

- [ ] **Step 7: Commit**

```bash
git add .changeset package.json pnpm-lock.yaml packages/*/package.json packages/*/CHANGELOG.md tests/package-manifests.spec.ts
git commit -m "feat: add fixed SDK versioning workflow" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 2: Add the Fail-Closed Release Contract

**Files:**
- Create: `release.config.json`
- Create: `scripts/release-readiness.mjs`
- Create: `scripts/verify-release-readiness.mjs`
- Create: `tests/release-readiness.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing release-contract tests**

Create tests that exercise real temporary manifests:

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  readReleaseConfig,
  validateReleaseReadiness,
} from '../scripts/release-readiness.mjs';

test('keeps publication disabled while packages are private', () => {
  const config = readReleaseConfig(workspaceRoot);

  expect(config.publishingEnabled).toBe(false);
  expect(() =>
    validateReleaseReadiness({
      root: workspaceRoot,
      mode: 'publish',
      version: '0.1.0',
      tag: 'sdk-v0.1.0',
    }),
  ).toThrow('Release publishing is disabled by release.config.json');
});

test('requires fixed versions and exact internal ranges', () => {
  const fixture = createReleaseFixture();
  const manifestPath = resolve(fixture, 'packages/sdk/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.dependencies['@opencoven/sdk-core'] = 'workspace:*';
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
    '@opencoven/sdk dependency @opencoven/sdk-core must be workspace:0.1.0',
  );
});

test('rejects version and tag disagreement', () => {
  expect(() =>
    validateReleaseReadiness({
      root: workspaceRoot,
      version: '0.2.0',
      tag: 'sdk-v0.1.0',
    }),
  ).toThrow('Release tag sdk-v0.1.0 does not match version 0.2.0');
});
```

The fixture helper copies `release.config.json`, all five package manifests,
and changelogs into a temporary root and removes it in `afterEach`.

- [ ] **Step 2: Run tests and confirm missing modules fail**

Run:

```bash
corepack pnpm@10.34.0 vitest run tests/release-readiness.spec.ts
```

Expected: FAIL because the release contract and validation modules do not exist.

- [ ] **Step 3: Create the release configuration**

Create `release.config.json` exactly as specified by the design:

```json
{
  "schemaVersion": 1,
  "publishingEnabled": false,
  "tagPrefix": "sdk-v",
  "npmAccess": "public",
  "npmDistTag": "latest",
  "githubEnvironment": "npm-release",
  "supportedNode": {
    "minimum": "24.18.0",
    "major": 24
  },
  "packages": [
    "@opencoven/sdk-core",
    "@opencoven/cave-client",
    "@opencoven/coven-client",
    "@opencoven/sdk",
    "@opencoven/dev-cli"
  ]
}
```

- [ ] **Step 4: Implement reusable validation**

Export these APIs from `scripts/release-readiness.mjs`:

```js
export function readReleaseConfig(root) {}

export function validateReleaseReadiness({
  root,
  mode = 'verify',
  version,
  tag,
  requireTag = false,
} = {}) {}
```

Validation must:

1. reject unknown or missing config fields;
2. compare `packages` to `PUBLIC_PACKAGES` in canonical order;
3. require all package versions to match;
4. require internal dependencies to use `workspace:<fixedVersion>`;
5. require engines `>=24.18.0 <25`;
6. require each changelog to contain `## <fixedVersion>`;
7. require `private === true` while `publishingEnabled === false`;
8. reject publish mode while disabled;
9. require all packages to be non-private when publish mode is enabled;
10. validate strict SemVer and `sdk-v<version>` tag agreement;
11. return:

```js
{
  version: fixedVersion,
  publishingEnabled: config.publishingEnabled,
  packages: PUBLIC_PACKAGES.map(({ packageName }) => packageName),
}
```

Use explicit property checks and stable error messages; do not silently default
invalid config.

- [ ] **Step 5: Add the CLI wrapper and canonical script**

`verify-release-readiness.mjs` parses:

```text
--mode verify|publish
--version <semver>
--tag <tag>
--require-tag
```

It calls `validateReleaseReadiness`, prints one JSON summary, and exits non-zero
on invalid options or contracts.

Add:

```json
"verify:release": "node ./scripts/verify-release-readiness.mjs"
```

Append `corepack pnpm@10.34.0 verify:release` after typecheck and before
coverage in the root `verify` command.

- [ ] **Step 6: Run focused and canonical contract tests**

Run:

```bash
corepack pnpm@10.34.0 vitest run tests/release-readiness.spec.ts tests/package-manifests.spec.ts
corepack pnpm@10.34.0 verify:release
```

Expected: all pass and the CLI reports version `0.1.0` with publishing disabled.

- [ ] **Step 7: Commit**

```bash
git add release.config.json scripts/release-readiness.mjs scripts/verify-release-readiness.mjs package.json tests/release-readiness.spec.ts
git commit -m "feat: add fail-closed release contract" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 3: Build Checksummed Release Artifacts

**Files:**
- Create: `scripts/create-release-artifacts.mjs`
- Create: `tests/release-artifacts.spec.ts`
- Modify: `scripts/pack-public-packages.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing artifact tests**

Test an explicit temporary output directory:

```ts
const result = createReleaseArtifacts({
  root: workspaceRoot,
  outputRoot,
  build: false,
});

expect(result.manifest.packages.map(({ name }) => name)).toEqual(
  PUBLIC_PACKAGES.map(({ packageName }) => packageName),
);

for (const entry of result.manifest.packages) {
  const bytes = readFileSync(resolve(outputRoot, entry.file));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
  expect(entry.size).toBe(bytes.byteLength);
}
```

Add tests that:

- two manifests over unchanged tarballs have identical package ordering;
- a modified tarball fails `verifyReleaseArtifacts`;
- omitted output creates an owned temp root and ownership stamp;
- `release-manifest.json` contains schema version, SDK version, and relative
  paths only.

- [ ] **Step 2: Run tests and confirm missing APIs fail**

Run:

```bash
corepack pnpm@10.34.0 vitest run tests/release-artifacts.spec.ts
```

Expected: FAIL because the artifact builder is absent.

- [ ] **Step 3: Implement the artifact builder**

Export:

```js
export function createReleaseArtifacts({
  root,
  outputRoot,
  build = true,
} = {}) {}

export function verifyReleaseArtifacts({ root, artifactRoot, version } = {}) {}
```

Implementation rules:

- call `validateReleaseReadiness({ root, version })`;
- reuse `packPublicPackages`;
- use `createOwnedTempDirectory` when `outputRoot` is omitted;
- write tarballs under `tarballs/<workspaceDirectory>/`;
- write `release-manifest.json` with:

```json
{
  "schemaVersion": 1,
  "version": "0.1.0",
  "packages": [
    {
      "name": "@opencoven/sdk-core",
      "version": "0.1.0",
      "file": "tarballs/core/opencoven-sdk-core-0.1.0.tgz",
      "size": 1234,
      "sha256": "<64 lowercase hex characters>"
    }
  ]
}
```

- use canonical package order;
- verify packed manifest names and versions;
- reject absolute paths, duplicate package names, digest mismatch, size
  mismatch, missing tarballs, and unexpected packages.

The CLI accepts `--output <directory>`, `--skip-build`, and `--version
<semver>`, then prints JSON containing `artifactRoot`, `manifestPath`, and the
manifest.

- [ ] **Step 4: Add the release-artifact command**

Add:

```json
"release:artifacts": "node ./scripts/create-release-artifacts.mjs"
```

Keep `pack:public` unchanged for existing consumers.

- [ ] **Step 5: Run artifact and packed verification**

Run:

```bash
corepack pnpm@10.34.0 vitest run tests/release-artifacts.spec.ts tests/pack-public-packages-artifact-paths.spec.ts
corepack pnpm@10.34.0 release:artifacts -- --output .artifacts/release-test --version 0.1.0
node ./scripts/verify-release-readiness.mjs --version 0.1.0
```

Expected: tests pass and `.artifacts/release-test/release-manifest.json`
contains five verified tarballs. Remove `.artifacts/release-test` after the
check.

- [ ] **Step 6: Commit**

```bash
git add scripts/create-release-artifacts.mjs package.json tests/release-artifacts.spec.ts
git commit -m "feat: create checksummed release artifacts" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 4: Enforce the Supported Node Matrix and Dependency Maintenance

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/dependabot.yml`
- Modify: `package.json`
- Modify: `tests/workflow-pins.spec.ts`
- Create: `tests/dependabot-config.spec.ts`

- [ ] **Step 1: Write failing CI and Dependabot assertions**

Add workflow assertions:

```ts
expect(ciWorkflow).toContain("node: ['24.18.1', '24.x']");
expect(ciWorkflow).toContain('run: corepack pnpm@10.34.0 verify:compat');
expect(ciWorkflow).toContain('run: corepack pnpm@10.34.0 verify');
```

Create Dependabot assertions:

```ts
expect(config).toContain('package-ecosystem: "npm"');
expect(config).toContain('package-ecosystem: "github-actions"');
expect(config.match(/interval: "weekly"/g)).toHaveLength(2);
expect(config).not.toContain('package-ecosystem: ""');
```

- [ ] **Step 2: Run tests and confirm the current single-version and invalid dependency configuration fails**

Run:

```bash
corepack pnpm@10.34.0 vitest run tests/workflow-pins.spec.ts tests/dependabot-config.spec.ts
```

Expected: FAIL on the missing matrix, compatibility command, and invalid
Dependabot ecosystem.

- [ ] **Step 3: Add the compatibility verifier**

Add:

```json
"verify:compat": "corepack pnpm@10.34.0 build && corepack pnpm@10.34.0 typecheck && corepack pnpm@10.34.0 test && corepack pnpm@10.34.0 verify:package"
```

Do not weaken the canonical `verify` command.

- [ ] **Step 4: Convert CI to an explicit Node 24 matrix**

Use:

```yaml
strategy:
  fail-fast: false
  matrix:
    node: ['24.18.1', '24.x']

steps:
  - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
  - uses: pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320 # v4.4.0
    with:
      version: 10.34.0
  - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
    with:
      node-version: ${{ matrix.node }}
      cache: pnpm
  - name: Install dependencies
    run: pnpm install --frozen-lockfile
  - name: Verify minimum supported Node
    if: matrix.node == '24.18.1'
    run: corepack pnpm@10.34.0 verify
  - name: Verify latest supported Node
    if: matrix.node == '24.x'
    run: corepack pnpm@10.34.0 verify:compat
```

Retain read-only permissions, concurrency cancellation, full SHA pins, and the
15-minute job timeout.

- [ ] **Step 5: Replace the invalid Dependabot configuration**

Use:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      development-dependencies:
        dependency-type: "development"
        update-types:
          - "minor"
          - "patch"
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

- [ ] **Step 6: Run tests and local compatibility verification**

Run:

```bash
corepack pnpm@10.34.0 vitest run tests/workflow-pins.spec.ts tests/dependabot-config.spec.ts
corepack pnpm@10.34.0 verify:compat
```

Expected: all pass on the local supported Node installation.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/ci.yml .github/dependabot.yml package.json tests/workflow-pins.spec.ts tests/dependabot-config.spec.ts
git commit -m "ci: verify the supported Node release matrix" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 5: Add Protected Attestation and Publish Automation

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `scripts/publish-release-artifacts.mjs`
- Modify: `scripts/release-readiness.mjs`
- Modify: `tests/release-readiness.spec.ts`
- Modify: `tests/workflow-pins.spec.ts`

- [ ] **Step 1: Write failing workflow security tests**

Read both workflows and assert:

```ts
expect(releaseWorkflow).toContain('workflow_dispatch:');
expect(releaseWorkflow).toContain('environment: npm-release');
expect(releaseWorkflow).toContain('id-token: write');
expect(releaseWorkflow).toContain('attestations: write');
expect(releaseWorkflow).not.toContain('NPM_TOKEN');
expect(releaseWorkflow).not.toContain('NODE_AUTH_TOKEN');
expect(releaseWorkflow).toContain(
  'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2',
);
expect(releaseWorkflow).toContain(
  'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0',
);
expect(releaseWorkflow).toContain(
  'actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a # v3.0.0',
);
```

Also assert the top-level release permissions are `contents: read` and only
the publish job grants OIDC/attestation permissions.

- [ ] **Step 2: Write failing publish-command tests**

Export:

```js
export function createNpmPublishArgs({ tarball, access, distTag }) {}
export function publishReleaseArtifacts({ root, artifactRoot, version, env, execute }) {}
```

Tests require:

```ts
expect(createNpmPublishArgs({
  tarball: '/tmp/pkg.tgz',
  access: 'public',
  distTag: 'latest',
})).toEqual([
  'publish',
  '/tmp/pkg.tgz',
  '--access',
  'public',
  '--tag',
  'latest',
  '--provenance',
]);

expect(() =>
  publishReleaseArtifacts({
    root: workspaceRoot,
    artifactRoot,
    version: '0.1.0',
    env: { OPENCOVEN_RELEASE_AUTHORIZATION: 'publish' },
    execute: () => {
      throw new Error('must not execute while locked');
    },
  }),
).toThrow('Release publishing is disabled by release.config.json');
```

Reject `NPM_TOKEN` or `NODE_AUTH_TOKEN` in regular publish mode.

- [ ] **Step 3: Run tests and confirm the workflow/script are missing**

Run:

```bash
corepack pnpm@10.34.0 vitest run tests/workflow-pins.spec.ts tests/release-readiness.spec.ts
```

Expected: FAIL on missing release workflow and publish script.

- [ ] **Step 4: Implement exact-artifact publishing**

`publishReleaseArtifacts` must:

1. call `validateReleaseReadiness({ mode: 'publish', version })`;
2. call `verifyReleaseArtifacts`;
3. require `OPENCOVEN_RELEASE_AUTHORIZATION === 'publish'`;
4. reject token environment variables;
5. publish packages in `PUBLIC_PACKAGES` order;
6. invoke `npm` with `createNpmPublishArgs`;
7. stop on the first non-zero publish;
8. never rebuild or repack.

The CLI accepts `--artifact-root` and `--version`.

- [ ] **Step 5: Extend release validation for workflow identity**

Require release config environment `npm-release`, workflow path
`.github/workflows/release.yml`, and tag prefix `sdk-v`. In `requireTag` mode,
run:

```bash
git rev-parse "refs/tags/sdk-v<version>^{commit}"
git rev-parse HEAD
```

and reject when the commits differ or the tag is absent.

- [ ] **Step 6: Create the pinned release workflow**

The workflow has `workflow_dispatch` inputs:

```yaml
mode:
  description: Verify artifacts or publish after all launch gates are open
  required: true
  type: choice
  options:
    - verify
    - publish
version:
  description: Exact fixed SDK version
  required: true
  type: string
```

The `preflight` job:

- checks out with `fetch-depth: 0`;
- sets up pnpm 10.34.0 and Node from `.node-version`;
- rejects non-`main` refs;
- installs frozen dependencies;
- runs canonical `verify`;
- validates version/tag with `--require-tag`;
- creates `.artifacts/release`;
- uploads artifact `opencoven-sdk-<version>`.

The `publish` job:

```yaml
if: inputs.mode == 'publish'
needs: preflight
environment: npm-release
permissions:
  contents: read
  id-token: write
  attestations: write
```

It checks out the same commit, downloads the artifact, validates publish mode,
attests `.artifacts/release/tarballs/**/*.tgz`, and runs:

```bash
OPENCOVEN_RELEASE_AUTHORIZATION=publish \
  node ./scripts/publish-release-artifacts.mjs \
  --artifact-root .artifacts/release \
  --version "${{ inputs.version }}"
```

Use only the existing pinned checkout/setup actions plus:

```yaml
actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0
actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a # v3.0.0
```

- [ ] **Step 7: Run focused workflow and release tests**

Run:

```bash
corepack pnpm@10.34.0 vitest run tests/workflow-pins.spec.ts tests/release-readiness.spec.ts tests/release-artifacts.spec.ts
corepack pnpm@10.34.0 verify:release
```

Expected: workflow/static tests pass; publish mode still fails closed because
`publishingEnabled` is false.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/release.yml scripts/publish-release-artifacts.mjs scripts/release-readiness.mjs tests/release-readiness.spec.ts tests/workflow-pins.spec.ts
git commit -m "feat: add protected SDK release workflow" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 6: Document Support, Security, Bootstrap, Rollback, and Incidents

**Files:**
- Create: `SUPPORT.md`
- Create: `SECURITY.md`
- Create: `RELEASING.md`
- Modify: `README.md`
- Create: `tests/release-policy.spec.ts`

- [ ] **Step 1: Write failing policy tests**

Assert:

```ts
expect(support).toContain('Node.js 24');
expect(support).toContain('latest minor');
expect(security).toContain('private vulnerability reporting');
expect(security).toContain('Do not open a public issue');
expect(releasing).toContain('First-publish bootstrap');
expect(releasing).toContain('npm-release');
expect(releasing).toContain('trusted publisher');
expect(releasing).toContain('deprecate');
expect(releasing).toContain('incident response');
expect(releasing).toContain('revoke');
expect(readme).toContain('[Release process](RELEASING.md)');
```

- [ ] **Step 2: Run the test and confirm documents are absent**

Run:

```bash
corepack pnpm@10.34.0 vitest run tests/release-policy.spec.ts
```

Expected: FAIL because policy documents are missing.

- [ ] **Step 3: Write `SUPPORT.md`**

State:

- Node `>=24.18.0 <25` only;
- latest pre-1.0 minor line receives fixes;
- GitHub issues require reproduction, package/version, Node version, and safe
  diagnostics;
- no SLA is promised;
- endpoint discovery, transport retries, persistent credential storage, and
  third-party transport behavior are outside SDK support.

- [ ] **Step 4: Write `SECURITY.md`**

State:

- use GitHub private vulnerability reporting;
- do not open public issues for suspected vulnerabilities;
- latest pre-1.0 minor is supported;
- reports need impact, affected package/version, reproduction, and mitigations;
- causes, credentials, tokens, payloads, and private endpoint data must be
  redacted;
- coordinated disclosure timing is determined after triage.

- [ ] **Step 5: Write `RELEASING.md`**

Include exact sections:

1. release locks and external prerequisites;
2. changeset and fixed-version preparation;
3. clean verification commands;
4. tag format `sdk-v<version>`;
5. verify-mode workflow;
6. first-publish bootstrap with one-time least-privilege credential and 2FA;
7. trusted-publisher setup for all five packages;
8. normal OIDC publish mode;
9. registry/provenance validation;
10. rollback by deprecation and corrective release;
11. incident response, environment suspension, credential revocation, evidence
    preservation, advisory, and postmortem.

Explicitly state that this phase does not publish packages or create external
configuration.

- [ ] **Step 6: Link policies without changing release status**

Keep the README warning and private status. Add:

```md
- [Support policy](SUPPORT.md)
- [Security policy](SECURITY.md)
- [Release process](RELEASING.md)
```

- [ ] **Step 7: Run policy and package tests**

Run:

```bash
corepack pnpm@10.34.0 vitest run tests/release-policy.spec.ts tests/package-manifests.spec.ts
```

Expected: pass with no package publication gates changed.

- [ ] **Step 8: Commit**

```bash
git add SUPPORT.md SECURITY.md RELEASING.md README.md tests/release-policy.spec.ts
git commit -m "docs: define SDK release and support policy" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 7: Integrate Packed Release Verification

**Files:**
- Modify: `scripts/verify-package.mjs`
- Modify: `tests/packed-package.spec.ts`
- Modify: `tests/release-artifacts.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Add failing packed changelog and release-manifest assertions**

Extend packed tests:

```ts
for (const { workspaceDirectory } of PUBLIC_PACKAGES) {
  expect(readTarballFile(tarballs[workspaceDirectory], 'CHANGELOG.md')).toContain(
    '## 0.1.0',
  );
}

expect(result.stdout).toContain('Release artifact manifest verified.');
```

Add a tamper test that writes one byte to a copied tarball and expects
`verifyReleaseArtifacts` to throw a SHA-256 mismatch.

- [ ] **Step 2: Run packed and artifact tests and confirm missing integration fails**

Run:

```bash
corepack pnpm@10.34.0 vitest run tests/packed-package.spec.ts tests/release-artifacts.spec.ts
```

Expected: FAIL because packed changelogs and release-manifest verification are
not yet integrated.

- [ ] **Step 3: Verify release artifacts inside package verification**

After the existing public package build, create a release bundle under the
owned verifier temp root with `build: false`, verify its manifest and digests,
then print:

```text
Release artifact manifest verified.
```

Do not perform a second build and do not publish.

- [ ] **Step 4: Add release verification to compatibility path**

Ensure `verify:compat` ends with both:

```text
verify:release
verify:package
```

and retains build, typecheck, and tests.

- [ ] **Step 5: Run focused verification**

Run:

```bash
corepack pnpm@10.34.0 vitest run tests/packed-package.spec.ts tests/release-artifacts.spec.ts tests/package-manifests.spec.ts
corepack pnpm@10.34.0 verify:package
```

Expected: all pass, five changelogs are packed, and release artifact digests
are verified.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-package.mjs package.json tests/packed-package.spec.ts tests/release-artifacts.spec.ts tests/package-manifests.spec.ts
git commit -m "test: verify packed release artifacts" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 8: Complete Integrated Verification and Delivery

**Files:**
- Modify only defects directly caused by Tasks 1–7.
- Update: `docs/superpowers/plans/2026-08-19-sdk-release-readiness.md`

- [ ] **Step 1: Run the canonical verifier**

```bash
corepack pnpm@10.34.0 verify
```

Expected: build, lint, typecheck, release contract, coverage, stress, contracts,
packed consumers, release artifacts, and examples pass.

- [ ] **Step 2: Run release-specific negative checks**

```bash
node ./scripts/verify-release-readiness.mjs \
  --mode publish \
  --version 0.1.0 \
  --tag sdk-v0.1.0
```

Expected: non-zero with
`Release publishing is disabled by release.config.json`.

```bash
corepack pnpm@10.34.0 release:artifacts -- \
  --output .artifacts/release-final \
  --version 0.1.0
node ./scripts/create-release-artifacts.mjs \
  --output .artifacts/release-final \
  --skip-build \
  --version 0.1.0
```

Expected: deterministic manifest validation; remove
`.artifacts/release-final` after inspection.

- [ ] **Step 3: Run hygiene and dependency checks**

```bash
pre-commit run --all-files
gitleaks git . --no-banner --redact
corepack pnpm@10.34.0 audit --audit-level high
git diff --check
```

Expected: all pass with no leaks or high-severity dependency findings.

- [ ] **Step 4: Request independent review**

Review the complete diff from `2f12c3d` to `HEAD`, focusing on:

- any path that could publish while locked;
- excessive workflow permissions;
- tag/commit race or mutable-ref behavior;
- artifact digest/path traversal issues;
- token leakage or fallback authentication;
- private-package/Changesets inconsistencies;
- first-publish bootstrap accuracy;
- Node matrix drift;
- temp-directory cleanup and packed compatibility.

Fix every Critical or Important finding with a failing regression test, then
rerun `pnpm verify`.

- [ ] **Step 5: Update plan completion record**

Record:

- commit hashes;
- final test and coverage totals;
- release-negative-test output;
- review findings and fixes;
- PR URL;
- hosted Node matrix and CodeQL results;
- merge commit;
- confirmation that no npm package, GitHub release, tag, environment, trusted
  publisher, or credential was created.

- [ ] **Step 6: Push, open, and merge the pull request**

```bash
git push -u origin feat/release-readiness
gh pr create \
  --base main \
  --head feat/release-readiness \
  --title "feat: add locked SDK release readiness" \
  --body $'## Summary\n- add fail-closed fixed-version release contracts and Changesets changelogs\n- add checksummed artifacts, protected OIDC/attestation workflow, and Node 24 matrix\n- add support, security, bootstrap, rollback, and incident policies\n\n## Verification\n- corepack pnpm@10.34.0 verify\n- release publish negative checks\n- pre-commit, Gitleaks, pnpm audit, and git diff --check'
gh pr checks --watch --interval 10
gh pr merge --merge --delete-branch
```

The PR body must summarize the two-key lock, Node support, Changesets, release
artifacts, workflow permissions, policies, and exact verification. Merge only
after both Node matrix jobs, CodeQL, and repository checks pass.

- [ ] **Step 7: Verify merged main and clean up**

Run canonical verification on the merge commit, remove the feature worktree,
prune the remote branch, and leave the primary repository clean on `main`.

## Dependency Order

1. Fixed-version Changesets and changelogs.
2. Release contract and fail-closed verifier.
3. Checksummed artifact builder.
4. Node support matrix and Dependabot.
5. Protected release workflow and exact-artifact publisher.
6. Support/security/release policies.
7. Packed release integration.
8. Full verification, review, PR, merge, and cleanup.

## Completion Criteria

- All five packages remain private and unpublished.
- Publish mode fails closed without a code unlock and protected environment.
- Fixed versions, exact internal ranges, tags, and changelogs are validated.
- Node `24.18.1` and latest `24.x` are both tested in hosted CI.
- Release artifacts are deterministic, checksummed, path-safe, and attestable.
- Regular publish automation contains no npm token path.
- The unpublished-package bootstrap is explicit and separate from OIDC releases.
- Support, security, deprecation, rollback, and incident policies are committed.
- Dependabot uses valid npm and GitHub Actions ecosystems.
- Canonical verification, packed consumers, release negatives, hygiene, audit,
  independent review, and hosted checks pass.

## Progress Record

- Worktree: `.worktrees/release-readiness`
- Branch: `feat/release-readiness`
- Base: `2f12c3d6072aa3764d2790e6a378691fb24e3cdc`
- Design: `0cfbf86`
- Implementation plan: `14dc1f9`
- Fixed-version Changesets and changelogs: `43a009d`
- Fail-closed release contract: `9ec3b41`
- Checksummed release artifacts: `a64cdfd`
- Node support matrix and Dependabot: `10944dc`
- Protected OIDC/attestation workflow: `55ca1fc`
- Support, security, bootstrap, rollback, and incident policy: `1246310`
- Packed release verification: `1d31c19`
- Deterministic package-mutating tests: `f2b77b2`
- Independent review found two important release-gate gaps: the verifier did
  not enforce the workflow's protected environment, and preflight did not
  assert a clean reviewed tree before packing. Regressions and fixes are in
  `d001852`.
- Canonical verification passed 31 test files and 240 tests with 93.11%
  statements, 88.50% branches, 99.29% functions, and 93.04% lines.
- All three deterministic fast-check seeds passed. Contract verification,
  offline packed consumers, runnable examples, the timeout canary, changelog
  packing, and release-manifest digest verification passed.
- Publish-mode negative verification fails closed with
  `Release publishing is disabled by release.config.json`.
- Pre-commit, Gitleaks, `pnpm audit --audit-level high`, and `git diff --check`
  passed.
- No npm package, GitHub release, tag, environment, trusted publisher,
  credential, or external publishing configuration was created.
- PR: https://github.com/OpenCoven/sdk/pull/22
- Hosted checks passed for Node `24.18.1`, latest `24.x`, CodeQL Actions,
  CodeQL JavaScript/TypeScript, and the repository CodeQL gate.
- PR #22 merged as `35b67b704fb10a5bb36a9c832afb3e5963fcc054`.
- Post-merge canonical verification passed on `main` after refreshing the
  frozen workspace install.
