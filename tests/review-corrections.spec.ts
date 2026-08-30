import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const selectorFiles = [
  'LICENSE',
  'packages/core/LICENSE',
  'packages/cave/LICENSE',
  'packages/coven/LICENSE',
  'packages/sdk/LICENSE',
  'packages/cli/LICENSE',
] as const;

describe('review corrections', () => {
  test('exposes exact runnable matrix scripts', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const sourceTypecheckConfig = JSON.parse(
      readFileSync(resolve(root, 'tsconfig.eslint.json'), 'utf8'),
    ) as {
      include: string[];
    };

    expect(manifest.scripts.typecheck).toBe(
      'corepack pnpm@10.34.0 exec tsc --pretty false --noEmit -p tsconfig.eslint.json',
    );
    expect(manifest.scripts['clean:public-dist']).toBe(
      'node ./scripts/clean-public-package-dist.mjs',
    );
    expect(manifest.scripts.test).toBe(
      'corepack pnpm@10.34.0 build && vitest run',
    );
    expect(manifest.scripts.verify).toBe(
      'corepack pnpm@10.34.0 typecheck && corepack pnpm@10.34.0 clean:public-dist && corepack pnpm@10.34.0 test && corepack pnpm@10.34.0 verify:contracts && corepack pnpm@10.34.0 verify:package && corepack pnpm@10.34.0 verify:development-release-configuration && corepack pnpm@10.34.0 test:coverage && corepack pnpm@10.34.0 test:stress && corepack pnpm@10.34.0 lint',
    );
    expect(sourceTypecheckConfig.include).toEqual([
      'examples/**/*.ts',
      'packages/**/*.ts',
      'tests/**/*.ts',
      'vitest.config.ts',
      'vitest.workspace.ts',
    ]);
    expect(manifest.scripts['verify-contracts']).toBe('node ./scripts/verify-contracts.mjs');
    expect(manifest.scripts['verify-package']).toBe('node ./scripts/verify-package.mjs');
  });

  test('identifies the SDK in every packed license selector', () => {
    for (const relativePath of selectorFiles) {
      const selector = readFileSync(resolve(root, relativePath), 'utf8');

      expect(selector).toContain('OpenCoven SDK');
      expect(selector).not.toContain('coven-cave');
    }
  });
});
