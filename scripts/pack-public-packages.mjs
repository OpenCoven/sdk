import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { packPublicPackages } from './package-artifacts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactBaseRoot = resolve(root, '.artifacts', 'pack-public-packages');
const defaultArtifactName = 'default';
const safeArtifactNamePattern = /^(?!\.{1,2}$)[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

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

function assertConfinedArtifactRoot(targetPath) {
  const normalizedArtifactBaseRoot = resolve(artifactBaseRoot);
  const normalizedRepositoryRoot = resolve(root);
  const normalizedTargetPath = resolve(targetPath);
  const normalizedHomeDirectory = resolve(homedir());
  const relativeToArtifactBase = relative(normalizedArtifactBaseRoot, normalizedTargetPath);

  if (
    normalizedTargetPath === resolve('/') ||
    normalizedTargetPath === normalizedHomeDirectory ||
    normalizedTargetPath === normalizedRepositoryRoot ||
    normalizedTargetPath === resolve(normalizedRepositoryRoot, '..') ||
    relativeToArtifactBase.length === 0 ||
    relativeToArtifactBase === '..' ||
    relativeToArtifactBase.startsWith(`..${sep}`) ||
    relativeToArtifactBase.split(sep).includes('..')
  ) {
    throw new Error(
      `Artifact cleanup path must stay inside a child of ${normalizedArtifactBaseRoot}.`,
    );
  }
}

export function resolvePackArtifactOutputDirectory(artifactName = defaultArtifactName) {
  if (!safeArtifactNamePattern.test(artifactName)) {
    throw new Error(
      `Artifact name "${artifactName}" must be a safe child name using only letters, digits, ".", "_" or "-".`,
    );
  }

  const outputDirectory = resolve(artifactBaseRoot, artifactName);
  assertConfinedArtifactRoot(outputDirectory);
  return outputDirectory;
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

  rmSync(options.outputDir, { force: true, recursive: true });
  mkdirSync(options.outputDir, { recursive: true });

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
