import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const config = readFileSync(resolve(root, 'eslint.config.mjs'), 'utf8');

describe('lint boundaries', () => {
  test('does not lint nested managed worktrees', () => {
    expect(config).toContain("'.worktrees/**'");
  });
});
