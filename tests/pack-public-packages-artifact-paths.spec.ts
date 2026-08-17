import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { resolvePackArtifactOutputDirectory } from '../scripts/pack-public-packages.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('pack-public-packages artifact directory safety', () => {
  test.each(['.', root, '..', '/Users/buns', '../escape'])(
    'rejects unsafe artifact name %s',
    (artifactName) => {
      expect(() => resolvePackArtifactOutputDirectory(artifactName)).toThrow(
        /safe child name|Artifact cleanup path must stay inside/,
      );
    },
  );

  test('accepts a confined artifact child name', () => {
    expect(resolvePackArtifactOutputDirectory('public-tarballs')).toBe(
      resolve(root, '.artifacts', 'pack-public-packages', 'public-tarballs'),
    );
  });
});
