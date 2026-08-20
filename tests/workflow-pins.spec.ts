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
const USES_PATTERN =
  /uses:\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([^\s#]+)(?:[^\S\n]+#[^\S\n]*(\S+))?/g;

function actionPins(source: string) {
  return [...source.matchAll(USES_PATTERN)].map(([, action, ref, comment]) => ({
    action,
    ref,
    comment,
  }));
}

describe('workflow action pins', () => {
  test('uses an explicit read-only GitHub token scope', () => {
    expect(workflow).toMatch(/^permissions:\n\s{2}contents: read\n/m);
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
      }
    }

    // The actions themselves are the requirement; which release they sit on is
    // Dependabot's business.
    for (const action of ['actions/checkout', 'pnpm/action-setup', 'actions/setup-node']) {
      expect(actionPins(workflow).map((pin) => pin.action)).toContain(action);
    }
  });

  test('runs the canonical verifier with bounded, cancellable execution', () => {
    const installStep = workflow.indexOf('- name: Install dependencies');
    const verifyStep = workflow.indexOf('- name: Verify');

    expect(workflow).toContain('cancel-in-progress: true');
    expect(workflow).toContain('timeout-minutes: 15');
    expect(workflow).toContain('run: corepack pnpm@10.34.0 verify');
    expect(installStep).toBeGreaterThanOrEqual(0);
    expect(verifyStep).toBeGreaterThan(installStep);
    expect(
      workflow.match(/run: corepack pnpm@10\.34\.0 verify$/gm),
    ).toHaveLength(1);
  });

  test('verifies the minimum and moving Node 24 targets', () => {
    expect(workflow).toContain("node: ['24.18.1', '24.x']");
    expect(workflow).toContain('run: corepack pnpm@10.34.0 verify:compat');
    expect(workflow).toContain('run: corepack pnpm@10.34.0 verify');
  });

  test('protects publishing with OIDC, attestations, and exact artifact actions', () => {
    expect(releaseWorkflow).toContain('workflow_dispatch:');
    expect(releaseWorkflow).toContain('environment: npm-release');
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
      'actions/attest-build-provenance',
    ]) {
      expect(actionPins(releaseWorkflow).map((pin) => pin.action)).toContain(action);
    }
    expect(releaseWorkflow).toMatch(/^permissions:\n\s{2}contents: read\n/m);
    expect(releaseWorkflow.match(/id-token: write/g)).toHaveLength(1);
    expect(releaseWorkflow.match(/attestations: write/g)).toHaveLength(1);
    expect(releaseWorkflow).toContain(
      "if [ -n \"$(git status --porcelain --untracked-files=all)\" ]; then",
    );
    // Presence first, then order. indexOf returns -1 for a missing step, and
    // -1 is less than any real index, so the comparison alone passed when
    // "Require clean reviewed tree" was absent entirely -- an assertion that
    // could not fail, guarding the step that keeps an unreviewed tree from
    // being released.
    const cleanTreeIndex = releaseWorkflow.indexOf('Require clean reviewed tree');
    const artifactsIndex = releaseWorkflow.indexOf('Create release artifacts');

    expect(cleanTreeIndex).toBeGreaterThan(-1);
    expect(artifactsIndex).toBeGreaterThan(-1);
    expect(cleanTreeIndex).toBeLessThan(artifactsIndex);
  });
});
