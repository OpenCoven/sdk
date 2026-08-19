import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const config = readFileSync(resolve(root, '.github/dependabot.yml'), 'utf8');

describe('Dependabot configuration', () => {
  test('updates npm and GitHub Actions every week', () => {
    expect(config).toContain('package-ecosystem: "npm"');
    expect(config).toContain('package-ecosystem: "github-actions"');
    expect(config.match(/interval: "weekly"/g)).toHaveLength(2);
    expect(config).not.toContain('package-ecosystem: ""');
  });

  test('groups compatible development dependency updates', () => {
    expect(config).toContain('development-dependencies:');
    expect(config).toContain('dependency-type: "development"');
    expect(config).toContain('- "minor"');
    expect(config).toContain('- "patch"');
  });
});
