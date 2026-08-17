import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('packed source exclusion verifier', () => {
  test('checks every installed public package, including @opencoven/sdk', () => {
    const verifier = readFileSync(resolve(root, 'scripts/verify-package.mjs'), 'utf8');

    expect(verifier).toContain("sdk: 'sdk'");
    expect(verifier).not.toContain("packageDirectory === 'sdk'");
  });
});
