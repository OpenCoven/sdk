import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  assertApiBaseline,
  createApiBaseline,
  readPackageApiSurface,
} from '../scripts/api-baselines.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PACKAGE_EXPORTS = {
  '.': {
    types: './dist/index.d.ts',
    import: './dist/index.js',
    default: './dist/index.js',
  },
  './package.json': './package.json',
};
const ENTRYPOINTS = {
  '.': {
    declarationFiles: ['dist/index.d.ts'],
    runtimeExports: {
      'dist/index.js': ['version'],
    },
  },
};

function baseline() {
  return createApiBaseline({
    declaration: '// Entry: .\n// File: dist/index.d.ts\nexport declare const version = "0.1.0";\n',
    entrypoints: ENTRYPOINTS,
    packageExports: PACKAGE_EXPORTS,
    packageName: '@opencoven/example',
  });
}

describe('packed API baselines', () => {
  test('accepts an exact packed declaration and export surface', () => {
    expect(() =>
      assertApiBaseline(baseline(), {
        declaration: '// Entry: .\n// File: dist/index.d.ts\nexport declare const version = "0.1.0";\n',
        entrypoints: ENTRYPOINTS,
        packageExports: PACKAGE_EXPORTS,
        packageName: '@opencoven/example',
      }),
    ).not.toThrow();
  });

  test('rejects a packed declaration signature change', () => {
    expect(() =>
      assertApiBaseline(baseline(), {
        declaration: '// Entry: .\n// File: dist/index.d.ts\nexport declare const version: string;\n',
        entrypoints: ENTRYPOINTS,
        packageExports: PACKAGE_EXPORTS,
        packageName: '@opencoven/example',
      }),
    ).toThrow(/declaration baseline/i);
  });

  test('rejects runtime export removal', () => {
    expect(() =>
      assertApiBaseline(baseline(), {
        declaration: '// Entry: .\n// File: dist/index.d.ts\nexport declare const version = "0.1.0";\n',
        entrypoints: {
          '.': {
            declarationFiles: ['dist/index.d.ts'],
            runtimeExports: {
              'dist/index.js': [],
            },
          },
        },
        packageExports: PACKAGE_EXPORTS,
        packageName: '@opencoven/example',
      }),
    ).toThrow(/entrypoint baseline/i);
  });

  test('rejects packed manifest export-map drift', () => {
    expect(() =>
      assertApiBaseline(baseline(), {
        declaration: '// Entry: .\n// File: dist/index.d.ts\nexport declare const version = "0.1.0";\n',
        entrypoints: ENTRYPOINTS,
        packageExports: {
          '.': './dist/index.js',
        },
        packageName: '@opencoven/example',
      }),
    ).toThrow(/package export baseline/i);
  });

  test('rejects conditional export reordering', () => {
    expect(() =>
      assertApiBaseline(baseline(), {
        declaration: '// Entry: .\n// File: dist/index.d.ts\nexport declare const version = "0.1.0";\n',
        entrypoints: ENTRYPOINTS,
        packageExports: {
          '.': {
            default: './dist/index.js',
            import: './dist/index.js',
            types: './dist/index.d.ts',
          },
          './package.json': './package.json',
        },
        packageName: '@opencoven/example',
      }),
    ).toThrow(/package export baseline/i);
  });

  test('rejects malformed baseline metadata', () => {
    expect(() =>
      assertApiBaseline(
        {
          ...baseline(),
          version: 3,
        },
        {
          declaration: '// Entry: .\n// File: dist/index.d.ts\nexport declare const version = "0.1.0";\n',
          entrypoints: ENTRYPOINTS,
          packageExports: PACKAGE_EXPORTS,
          packageName: '@opencoven/example',
        },
      ),
    ).toThrow(/baseline metadata/i);
  });

  test('baselines every exported entrypoint and root declaration chunk', async () => {
    const caveRoot = resolve(root, 'packages/cave');
    const surface = await readPackageApiSurface({
      packageName: '@opencoven/cave-client',
      packageRoot: caveRoot,
    });
    const expected = createApiBaseline(surface);
    const rootEntrypoint = surface.entrypoints['.'];

    expect(surface.entrypoints).toHaveProperty('.');
    expect(surface.entrypoints).toHaveProperty('./managed');
    if (rootEntrypoint === undefined) {
      throw new Error('Cave root entrypoint was missing.');
    }
    expect(
      rootEntrypoint.declarationFiles.some((file) =>
        /^dist\/client-[A-Za-z0-9]+\.d\.ts$/u.test(file),
      ),
    ).toBe(true);
    expect(() =>
      assertApiBaseline(expected, {
        ...surface,
        declaration: surface.declaration.replace(
          'declare',
          'declare changed',
        ),
      }),
    ).toThrow(/declaration baseline/i);
  });

  test('fails baseline comparison when managed or browser exported surfaces change', async () => {
    const caveSurface = await readPackageApiSurface({
      packageName: '@opencoven/cave-client',
      packageRoot: resolve(root, 'packages/cave'),
    });
    const coreSurface = await readPackageApiSurface({
      packageName: '@opencoven/sdk-core',
      packageRoot: resolve(root, 'packages/core'),
    });
    const changedManaged = structuredClone(caveSurface);
    const changedBrowser = structuredClone(coreSurface);
    const managedEntrypoint = changedManaged.entrypoints['./managed'];
    const browserEntrypoint = changedBrowser.entrypoints['./browser'];

    if (managedEntrypoint === undefined || browserEntrypoint === undefined) {
      throw new Error('Expected managed and browser entrypoints were missing.');
    }
    managedEntrypoint.runtimeExports['dist/managed.js'] = [];
    browserEntrypoint.declarationFiles = [];

    expect(() =>
      assertApiBaseline(createApiBaseline(caveSurface), changedManaged),
    ).toThrow(/entrypoint baseline/i);
    expect(() =>
      assertApiBaseline(createApiBaseline(coreSurface), changedBrowser),
    ).toThrow(/entrypoint baseline/i);
  });
});
