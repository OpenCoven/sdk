import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createOwnedTempDirectory } from './owned-temp-directory.mjs';
import { packPublicPackages } from './package-artifacts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function printUsage() {
  process.stdout.write(
    [
      'usage: pack-public-packages.mjs [--skip-build] [--json-file <path>]',
      '',
      'Packs the reviewed public SDK packages into tarballs and prints a JSON map',
      'and owning temp artifact root for callers that need packed tarballs.',
      '',
    ].join('\n'),
  );
}

export function createPackArtifactOutputDirectory() {
  return createOwnedTempDirectory({
    prefix: 'opencoven-sdk-pack-public-packages',
    childSegments: ['tarballs'],
  });
}

export function parseArgs(argv) {
  const options = {
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

  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const artifactDirectory = createPackArtifactOutputDirectory();
  const json = `${JSON.stringify(
    {
      artifactRoot: artifactDirectory.rootPath,
      tarballs: packPublicPackages({
        root,
        destinationRoot: artifactDirectory.path,
        build: options.build,
      }),
    },
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
