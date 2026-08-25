import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  apiBaselinePaths,
  readPackedApiSurfaces,
} from './api-baselines.mjs';
import {
  packPublicPackages,
} from './package-artifacts.mjs';
import {
  cleanupOwnedTempRoot,
  createOwnedTempDirectory,
} from './owned-temp-directory.mjs';
import { PUBLIC_PACKAGES } from './repository-metadata.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let artifactContext;

try {
  artifactContext = createOwnedTempDirectory({
    prefix: 'opencoven-api-baselines',
  });
  const tarballs = packPublicPackages({
    root,
    destinationRoot: resolve(artifactContext.rootPath, 'tarballs'),
  });
  const surfaces = await readPackedApiSurfaces({
    artifactRoot: resolve(artifactContext.rootPath, 'runtime'),
    packages: PUBLIC_PACKAGES,
    tarballs,
  });

  for (const { workspaceDirectory } of PUBLIC_PACKAGES) {
    const surface = surfaces[workspaceDirectory];
    if (surface === undefined) {
      throw new Error(
        `Packed API surface was missing for ${workspaceDirectory}.`,
      );
    }
    const paths = apiBaselinePaths(root, workspaceDirectory);
    mkdirSync(dirname(paths.declaration), { recursive: true });
    writeFileSync(paths.declaration, surface.declaration);
    writeFileSync(
      paths.metadata,
      `${JSON.stringify(
        {
          version: surface.version,
          packageName: surface.packageName,
          packageExports: surface.packageExports,
          runtimeExports: surface.runtimeExports,
        },
        null,
        2,
      )}\n`,
    );
  }

  process.stdout.write('Packed API baselines updated.\n');
} finally {
  if (artifactContext !== undefined) {
    cleanupOwnedTempRoot(artifactContext);
  }
}
