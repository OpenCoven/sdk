import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  prepareArtifactDirectory,
  removeArtifactPath,
  resolveArtifactDirectory,
} from './artifact-directory.mjs';
import { packPublicPackages } from './package-artifacts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultArtifactName = 'default';

function printUsage() {
  process.stdout.write(
    [
      'usage: pack-public-packages.mjs [--artifact-name <safe-child-name>] [--skip-build]',
      '',
      'Packs the reviewed public SDK packages into tarballs and prints a JSON map',
      'from workspace package directory names to tarball paths.',
      '',
    ].join('\n'),
  );
}

function resolvePackArtifactContext(repositoryRoot = root, artifactName = defaultArtifactName) {
  return resolveArtifactDirectory({
    repositoryRoot,
    parentSegments: ['pack-public-packages'],
    parentLabel: 'Artifact directory',
    artifactName,
  });
}

export function resolvePackArtifactOutputDirectory(
  artifactName = defaultArtifactName,
  options = {},
) {
  return resolvePackArtifactContext(options.repositoryRoot, artifactName).artifactPath;
}

export function preparePackArtifactOutputDirectory(
  artifactName = defaultArtifactName,
  options = {},
) {
  return prepareArtifactDirectory({
    repositoryRoot: options.repositoryRoot ?? root,
    parentSegments: ['pack-public-packages'],
    parentLabel: 'Artifact directory',
    artifactName,
  }).artifactPath;
}

export function removePackArtifactOutputDirectory(outputDirectory, options = {}) {
  const context = resolvePackArtifactContext(options.repositoryRoot ?? root, defaultArtifactName);

  removeArtifactPath(
    outputDirectory,
    {
      artifactBasePath: context.parentPath,
      artifactBaseRealPath: context.parentRealPath,
    },
  );
}

export function parseArgs(argv) {
  const options = {
    artifactName: process.env.OPENCOVEN_PACK_PUBLIC_ARTIFACT_NAME ?? defaultArtifactName,
    build: true,
    jsonFile: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help') {
      printUsage();
      process.exit(0);
    }

    if (argument === '--skip-build') {
      options.build = false;
      continue;
    }

    if (argument === '--artifact-name') {
      const artifactName = argv[index + 1];

      if (artifactName === undefined) {
        throw new Error('Missing value for --artifact-name.');
      }

      options.artifactName = artifactName;
      index += 1;
      continue;
    }

    if (argument === '--json-file') {
      const jsonFile = argv[index + 1];

      if (jsonFile === undefined) {
        throw new Error('Missing value for --json-file.');
      }

      options.jsonFile = resolve(jsonFile);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  options.outputDir = resolvePackArtifactOutputDirectory(options.artifactName);
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  preparePackArtifactOutputDirectory(options.artifactName);

  const json = `${JSON.stringify(
    packPublicPackages({
      root,
      destinationRoot: options.outputDir,
      build: options.build,
    }),
    null,
    2,
  )}\n`;

  if (options.jsonFile !== undefined) {
    writeFileSync(options.jsonFile, json);
  }

  process.stdout.write(json);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
