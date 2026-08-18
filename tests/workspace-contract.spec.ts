import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageDirectories = ['core', 'cave', 'coven', 'sdk', 'cli'] as const;

describe('workspace contract', () => {
  test('uses a Vitest 4 project definition for package and example tests', () => {
    const workspacePath = resolve(root, 'vitest.workspace.ts');

    expect(existsSync(workspacePath)).toBe(true);

    const workspace = readFileSync(workspacePath, 'utf8');
    const rootConfig = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8');

    expect(workspace).toContain("defineProject");
    expect(workspace).toContain("packages/*/test/**/*.spec.ts");
    expect(workspace).toContain("examples/*/test/**/*.spec.ts");
    expect(rootConfig).toContain("'./vitest.workspace.js'");
  });

  test('uses the approved SPDX expression in manifests and documentation', () => {
    const documentation = ['README.md', ...packageDirectories.map((directory) => `packages/${directory}/README.md`)];

    for (const directory of packageDirectories) {
      const manifest = JSON.parse(readFileSync(resolve(root, `packages/${directory}/package.json`), 'utf8')) as {
        license: string;
      };

      expect(manifest.license).toBe('AGPL-3.0-only OR MIT');
    }

    const rootManifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      license: string;
    };

    expect(rootManifest.license).toBe('AGPL-3.0-only OR MIT');

    for (const relativePath of documentation) {
      expect(readFileSync(resolve(root, relativePath), 'utf8')).toContain('AGPL-3.0-only OR MIT');
    }
  });
});
