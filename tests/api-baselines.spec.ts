import { describe, expect, test } from 'vitest';

import {
  assertApiBaseline,
  createApiBaseline,
} from '../scripts/api-baselines.mjs';

const PACKAGE_EXPORTS = {
  '.': {
    types: './dist/index.d.ts',
    import: './dist/index.js',
    default: './dist/index.js',
  },
  './package.json': './package.json',
};

function baseline() {
  return createApiBaseline({
    declaration: 'export declare const version = "0.1.0";\n',
    packageExports: PACKAGE_EXPORTS,
    packageName: '@opencoven/example',
    runtimeExports: ['version'],
  });
}

describe('packed API baselines', () => {
  test('accepts an exact packed declaration and export surface', () => {
    expect(() =>
      assertApiBaseline(baseline(), {
        declaration: 'export declare const version = "0.1.0";\n',
        packageExports: PACKAGE_EXPORTS,
        packageName: '@opencoven/example',
        runtimeExports: ['version'],
      }),
    ).not.toThrow();
  });

  test('rejects a packed declaration signature change', () => {
    expect(() =>
      assertApiBaseline(baseline(), {
        declaration: 'export declare const version: string;\n',
        packageExports: PACKAGE_EXPORTS,
        packageName: '@opencoven/example',
        runtimeExports: ['version'],
      }),
    ).toThrow(/declaration baseline/i);
  });

  test('rejects runtime export removal', () => {
    expect(() =>
      assertApiBaseline(baseline(), {
        declaration: 'export declare const version = "0.1.0";\n',
        packageExports: PACKAGE_EXPORTS,
        packageName: '@opencoven/example',
        runtimeExports: [],
      }),
    ).toThrow(/runtime export baseline/i);
  });

  test('rejects packed manifest export-map drift', () => {
    expect(() =>
      assertApiBaseline(baseline(), {
        declaration: 'export declare const version = "0.1.0";\n',
        packageExports: {
          '.': './dist/index.js',
        },
        packageName: '@opencoven/example',
        runtimeExports: ['version'],
      }),
    ).toThrow(/package export baseline/i);
  });

  test('rejects conditional export reordering', () => {
    expect(() =>
      assertApiBaseline(baseline(), {
        declaration: 'export declare const version = "0.1.0";\n',
        packageExports: {
          '.': {
            default: './dist/index.js',
            import: './dist/index.js',
            types: './dist/index.d.ts',
          },
          './package.json': './package.json',
        },
        packageName: '@opencoven/example',
        runtimeExports: ['version'],
      }),
    ).toThrow(/package export baseline/i);
  });

  test('rejects malformed baseline metadata', () => {
    expect(() =>
      assertApiBaseline(
        {
          ...baseline(),
          version: 2,
        },
        {
          declaration: 'export declare const version = "0.1.0";\n',
          packageExports: PACKAGE_EXPORTS,
          packageName: '@opencoven/example',
          runtimeExports: ['version'],
        },
      ),
    ).toThrow(/baseline metadata/i);
  });
});
