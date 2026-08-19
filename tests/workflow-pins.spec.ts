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
    const uses = [...workflow.matchAll(/uses:\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([^\s#]+)/g)];

    expect(uses.length).toBeGreaterThan(0);

    for (const [, action, ref] of uses) {
      expect(ref, `${action} must be pinned to a full commit SHA.`).toMatch(/^[0-9a-f]{40}$/);
    }

    expect(workflow).toMatch(/actions\/checkout@[0-9a-f]{40}\s+# v4\.4\.0/);
    expect(workflow).toMatch(/pnpm\/action-setup@[0-9a-f]{40}\s+# v4\.4\.0/);
    expect(workflow).toMatch(/actions\/setup-node@[0-9a-f]{40}\s+# v4\.4\.0/);
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
    expect(releaseWorkflow).toContain(
      'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2',
    );
    expect(releaseWorkflow).toContain(
      'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0',
    );
    expect(releaseWorkflow).toContain(
      'actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a # v3.0.0',
    );
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
