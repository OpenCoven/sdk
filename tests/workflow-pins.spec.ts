import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
const releaseWorkflowPath = resolve(root, '.github/workflows/release.yml');
const releaseWorkflow = existsSync(releaseWorkflowPath)
  ? readFileSync(releaseWorkflowPath, 'utf8')
  : '';
const preCommitConfigPath = resolve(root, '.pre-commit-config.yaml');

/**
 * Every `uses:` in a workflow, with its ref and its trailing comment.
 *
 * What these tests protect is that third-party actions are pinned to an
 * immutable commit and labelled with the release that commit belongs to. That
 * is a property of the pin, not of any particular version -- and asserting the
 * version froze it: Dependabot's bumps keep the SHA pin and update the comment,
 * exactly as intended, and failed a test that named the old version.
 */
/**
 * A release tag, as the comment beside a pinned SHA.
 *
 * Checked for shape rather than merely for existing. "Names the release it
 * pins" is what the failure message claims, and a bare `# pinned` would
 * satisfy a presence check while making that claim false -- a weaker guarantee
 * is worse for being stated as the stronger one.
 */
const RELEASE_TAG = /^v\d+(?:\.\d+){0,2}$/;

const USES_PATTERN =
  /uses:\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([^\s#]+)(?:[^\S\n]+#[^\S\n]*(\S+))?/g;
const DIRECT_DISPATCH_INPUT_PATTERN =
  /\$\{\{[^}]*\binputs\s*(?:\.|\[)[^}]*\}\}/u;

function actionPins(source: string) {
  return [...source.matchAll(USES_PATTERN)].map(([, action, ref, comment]) => ({
    action,
    ref,
    comment,
  }));
}

function runScripts(source: string): string[] {
  const lines = source.split('\n');
  const scripts: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const match = /^(\s+)(?:-\s+)?run:\s*(.*)$/u.exec(line);
    if (match === null) {
      continue;
    }
    const indentation = match[1]?.length ?? 0;
    const first = match[2] ?? '';
    if (first !== '|' && first !== '>-') {
      scripts.push(first);
      continue;
    }
    const body: string[] = [];
    for (index += 1; index < lines.length; index += 1) {
      const candidate = lines[index] ?? '';
      const candidateIndentation =
        candidate.length - candidate.trimStart().length;
      if (candidate.trim().length > 0 && candidateIndentation <= indentation) {
        index -= 1;
        break;
      }
      body.push(candidate);
    }
    scripts.push(body.join('\n'));
  }

  return scripts;
}

function checkoutSteps(source: string): string[] {
  const lines = source.split('\n');
  const steps: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s+- uses: actions\/checkout@/u.test(lines[index] ?? '')) {
      continue;
    }
    const block = [lines[index] ?? ''];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (/^\s+- (?:uses|name):/u.test(line)) {
        index -= 1;
        break;
      }
      block.push(line);
    }
    steps.push(block.join('\n'));
  }

  return steps;
}

describe('workflow action pins', () => {
  test('runs branch validation once through pull requests and still verifies main pushes', () => {
    expect(workflow).toMatch(
      /^on:\n\s{2}push:\n\s{4}branches:\n\s{6}- main\n\s{2}pull_request:\n/m,
    );
    expect(workflow).not.toContain("- '**'");
  });

  test('uses an explicit read-only GitHub token scope', () => {
    expect(workflow).toMatch(
      /^permissions:\n\s{2}contents: read\n/m,
    );
    expect(workflow).not.toContain('  actions: read');
    expect(workflow).not.toContain('  attestations: read');
    expect(workflow).not.toContain('  deployments: read');
    expect(workflow).not.toContain('  issues: read');
  });

  test('configures staged secret detection', () => {
    expect(existsSync(preCommitConfigPath)).toBe(true);

    const config = readFileSync(preCommitConfigPath, 'utf8');

    expect(config).toContain('repo: https://github.com/gitleaks/gitleaks');
    expect(config).toContain('id: detect-private-key');
  });

  test('pins third-party actions to full commit SHAs with release comments', () => {
    // Both workflows, not just CI. The release workflow is the one that can
    // publish, so an unpinned action there matters more, and it was never
    // checked.
    for (const [name, source] of [
      ['ci.yml', workflow],
      ['release.yml', releaseWorkflow],
    ] as const) {
      const pins = actionPins(source);

      expect(pins.length, `${name} should use at least one action.`).toBeGreaterThan(0);

      for (const { action, ref, comment } of pins) {
        expect(ref, `${name}: ${action} must be pinned to a full commit SHA.`).toMatch(
          /^[0-9a-f]{40}$/,
        );
        expect(comment, `${name}: ${action} must name the release it pins.`).toBeDefined();
        expect(comment, `${name}: ${action} comment must be a release tag.`).toMatch(RELEASE_TAG);
      }
    }

    // The actions themselves are the requirement; which release they sit on is
    // Dependabot's business.
    for (const action of ['actions/checkout', 'pnpm/action-setup', 'actions/setup-node']) {
      expect(actionPins(workflow).map((pin) => pin.action)).toContain(action);
    }
  });

  test('does not persist checkout credentials beyond action steps', () => {
    for (const [name, source] of [
      ['ci.yml', workflow],
      ['release.yml', releaseWorkflow],
    ] as const) {
      const checkoutCount = actionPins(source).filter(
        ({ action }) => action === 'actions/checkout',
      ).length;
      const disabledPersistenceCount =
        source.match(/persist-credentials: false/gu)?.length ?? 0;

      expect(
        disabledPersistenceCount,
        `${name} must disable persisted credentials for every checkout`,
      ).toBe(checkoutCount);
    }
  });

  test('runs the canonical verifier with bounded, cancellable execution', () => {
    const installStep = workflow.indexOf('- name: Install dependencies');
    const verifyStep = workflow.indexOf(
      '- name: Verify exact release runtime',
    );

    expect(workflow).toContain('cancel-in-progress: true');
    expect(workflow).toContain('timeout-minutes: 15');
    expect(workflow).toContain(
      'run: corepack pnpm@10.34.0 verify',
    );
    expect(installStep).toBeGreaterThanOrEqual(0);
    expect(verifyStep).toBeGreaterThan(installStep);
    expect(
      workflow.match(/run: corepack pnpm@10\.34\.0 verify$/gm),
    ).toHaveLength(1);
  });

  test('separates exact release verification from moving Node 24 compatibility', () => {
    expect(workflow).toContain("node: ['24.18.1', '24.x']");
    expect(workflow).toContain('run: corepack pnpm@10.34.0 verify:compat');
    expect(workflow).toContain(
      'run: corepack pnpm@10.34.0 verify',
    );
    expect(workflow).not.toContain(
      'run: node ./scripts/verify-release-readiness.mjs',
    );
    const compatibilityStep = workflow.slice(
      workflow.indexOf('- name: Verify Node 24 package compatibility'),
    );
    expect(compatibilityStep).not.toContain('verify:release');
  });

  test('checks out complete SDK history anywhere full security tests run', () => {
    const ciSdkCheckouts = checkoutSteps(workflow).filter(
      (step) => !step.includes('repository: OpenCoven/coven-cave'),
    );
    expect(ciSdkCheckouts).toHaveLength(1);
    expect(ciSdkCheckouts[0]).toContain('fetch-depth: 0');

    const repositoryVerificationJob = releaseWorkflow.slice(
      releaseWorkflow.indexOf('\n  repository-verification:\n'),
      releaseWorkflow.indexOf('\n  publication-candidate:\n'),
    );
    const releaseSdkCheckouts = checkoutSteps(repositoryVerificationJob).filter(
      (step) => !step.includes('repository: OpenCoven/coven-cave'),
    );
    expect(releaseSdkCheckouts).toHaveLength(1);
    expect(releaseSdkCheckouts[0]).toContain('fetch-depth: 0');

    const caveCheckout = checkoutSteps(workflow).find(
      (step) => step.includes('repository: OpenCoven/coven-cave'),
    );
    expect(caveCheckout).toBeDefined();
    const swappedDepths = workflow
      .replace(
        ciSdkCheckouts[0] ?? '',
        (ciSdkCheckouts[0] ?? '').replace('fetch-depth: 0', 'fetch-depth: 1'),
      )
      .replace(
        caveCheckout ?? '',
        (caveCheckout ?? '').replace('fetch-depth: 1', 'fetch-depth: 0'),
      );
    const regressedSdkCheckout = checkoutSteps(swappedDepths).find(
      (step) => !step.includes('repository: OpenCoven/coven-cave'),
    );
    expect(regressedSdkCheckout).not.toContain('fetch-depth: 0');
  });

  test('protects publishing with OIDC, attestations, and exact artifact actions', () => {
    expect(releaseWorkflow).toContain('workflow_dispatch:');
    expect(releaseWorkflow).toContain('environment: npm-release');
    const publishJob = releaseWorkflow.slice(
      releaseWorkflow.indexOf('\n  publish:\n'),
    );
    expect(publishJob).toContain('environment: npm-publish');
    expect(publishJob).not.toContain('environment: npm-release');
    expect(releaseWorkflow).toContain('id-token: write');
    expect(releaseWorkflow).toContain('attestations: write');
    expect(releaseWorkflow).not.toContain('NPM_TOKEN');
    expect(releaseWorkflow).not.toContain('NODE_AUTH_TOKEN');
    // These three actions must be present and SHA-pinned; the pin itself is
    // asserted for every action by the test above. Naming their exact SHAs
    // here froze the versions and blocked every bump.
    for (const action of [
      'actions/upload-artifact',
      'actions/download-artifact',
      'actions/attest',
    ]) {
      expect(actionPins(releaseWorkflow).map((pin) => pin.action)).toContain(action);
    }
    expect(releaseWorkflow).toMatch(/^permissions:\n\s{2}contents: read\n/m);
    expect(releaseWorkflow.match(/id-token: write/g)).toHaveLength(4);
    expect(releaseWorkflow.match(/attestations: write/g)).toHaveLength(3);
    expect(releaseWorkflow).toContain(
      "if [ -n \"$(git status --porcelain --untracked-files=all)\" ]; then",
    );
    // Presence first, then order. indexOf returns -1 for a missing step, and
    // -1 is less than any real index, so the comparison alone passed when
    // "Require clean reviewed tree" was absent entirely -- an assertion that
    // could not fail, guarding the step that keeps an unreviewed tree from
    // being released.
    const cleanTreeIndex = releaseWorkflow.indexOf('Require clean reviewed tree');
    const artifactsIndex = releaseWorkflow.indexOf(
      'Create immutable publication candidate',
    );

    expect(cleanTreeIndex).toBeGreaterThan(-1);
    expect(artifactsIndex).toBeGreaterThan(-1);
    expect(cleanTreeIndex).toBeLessThan(artifactsIndex);
  });

  test('authenticates protected Node entrypoints and ignores repository package-manager hooks', () => {
    expect(releaseWorkflow).toContain(
      'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a',
    );
    expect(releaseWorkflow).toContain(
      'node_path="$RUNNER_TOOL_CACHE/node/24.18.1/x64/bin/node"',
    );
    expect(releaseWorkflow).toContain('/usr/bin/sha256sum --check --strict');
    expect(releaseWorkflow).toContain('/usr/bin/env -i');
    const releaseBuilder = readFileSync(
      resolve(root, 'scripts/create-release-artifacts.mjs'),
      'utf8',
    );
    const packageArtifacts = readFileSync(
      resolve(root, 'scripts/package-artifacts.mjs'),
      'utf8',
    );
    const runtimeIntegrity = readFileSync(
      resolve(root, 'scripts/release-runtime-integrity.mjs'),
      'utf8',
    );
    expect(releaseBuilder).toContain('protectedPnpmArguments');
    expect(runtimeIntegrity).toContain("'--ignore-pnpmfile'");
    expect(packageArtifacts).toContain('--config.pnpmfile=/dev/null');
    expect(releaseWorkflow).not.toMatch(
      /publication-candidate:[\s\S]*?uses: pnpm\/action-setup@/u,
    );
    expect(releaseWorkflow).not.toMatch(
      /publish:[\s\S]*?uses: pnpm\/action-setup@/u,
    );
  });

  test('requires attested pending and protected approval evidence before publish', () => {
    expect(releaseWorkflow).toContain('\n  approval-witness:\n');
    expect(releaseWorkflow).toContain('\n  approval-witness-attestation:\n');
    expect(releaseWorkflow).toContain('\n  approval-evidence:\n');
    expect(releaseWorkflow).toContain('\n  approval-evidence-attestation:\n');
    expect(releaseWorkflow).toContain(
      'environment: npm-release',
    );
    expect(releaseWorkflow).toContain(
      'opencoven-sdk-pending-approval-${{ github.run_id }}-${{ github.run_attempt }}',
    );
    expect(releaseWorkflow).toContain(
      'opencoven-sdk-protected-approval-${{ github.run_id }}-${{ github.run_attempt }}',
    );
    expect(releaseWorkflow).toContain(
      'needs: [preflight, repository-verification, approval-witness, approval-witness-attestation, approval-evidence, approval-evidence-attestation]',
    );
    expect(releaseWorkflow).toContain(
      'PUBLISH_JOB_ID: ${{ needs.approval-evidence.outputs.publish-job-id }}',
    );
    const publisherStep = releaseWorkflow.slice(
      releaseWorkflow.indexOf(
        '      - name: Publish exact reviewed release artifacts\n',
      ),
    );
    expect(publisherStep).toContain(
      'GITHUB_SERVER_URL="$GITHUB_SERVER_URL"',
    );
    expect(publisherStep).toContain('PUBLISH_JOB_ID="$PUBLISH_JOB_ID"');
    const approvalVerificationStep = releaseWorkflow.slice(
      releaseWorkflow.indexOf(
        '      - name: Verify exact reviewed publication bytes\n',
      ),
      releaseWorkflow.indexOf(
        '      - name: Publish exact reviewed release artifacts\n',
      ),
    );
    expect(approvalVerificationStep).toContain(
      'PUBLISH_JOB_ID="$PUBLISH_JOB_ID"',
    );
  });

  test('never interpolates dispatch inputs directly into release shell scripts', () => {
    const scripts = runScripts(releaseWorkflow);
    const combinedScripts = scripts.join('\n');

    expect(combinedScripts).not.toMatch(DIRECT_DISPATCH_INPUT_PATTERN);
    for (const unsafeExpression of [
      '${{ inputs.version }}',
      '${{inputs.version}}',
      '${{ inputs.version}}',
      '${{ inputs.version  }}',
      '${{ inputs . version }}',
      '${{ inputs.release-tag }}',
      "${{ inputs['version'] }}",
      '${{ github.event.inputs.version }}',
    ]) {
      expect(unsafeExpression).toMatch(DIRECT_DISPATCH_INPUT_PATTERN);
    }
    expect(releaseWorkflow.match(/RELEASE_VERSION: \$\{\{ inputs\.version \}\}/gu))
      .toHaveLength(3);
    expect(combinedScripts).toContain('--version "$RELEASE_VERSION"');
    expect(combinedScripts).toContain('--tag "sdk-v$RELEASE_VERSION"');
  });
});
