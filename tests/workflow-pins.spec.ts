import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
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

  test('builds workspace packages before running typed lint checks', () => {
    const buildStep = workflow.indexOf('- name: Build');
    const lintStep = workflow.indexOf('- name: Lint');

    expect(buildStep).toBeGreaterThanOrEqual(0);
    expect(lintStep).toBeGreaterThanOrEqual(0);
    expect(buildStep).toBeLessThan(lintStep);
  });
});
