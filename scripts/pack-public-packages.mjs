import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { packPublicPackages } from './package-artifacts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function printUsage() {
  process.stdout.write(
    [
      'usage: pack-public-packages.mjs [--output-dir <path>] [--skip-build]',
      '',
      'Packs the reviewed public SDK packages into tarballs and prints a JSON map',
      'from workspace package directory names to tarball paths.',
      '',
    ].join('\n'),
  );
}

function parseArgs(argv) {
  const options = {
    outputDir: resolve(root, '.artifacts', 'pack-public-packages'),
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

    if (argument === '--output-dir') {
      const outputDir = argv[index + 1];

      if (outputDir === undefined) {
        throw new Error('Missing value for --output-dir.');
      }

      options.outputDir = resolve(outputDir);
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

  return options;
}

const options = parseArgs(process.argv.slice(2));

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
