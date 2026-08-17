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
  test('exposes exact runnable verification scripts', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

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
