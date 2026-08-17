import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = resolve(root, '.artifacts', 'verify-package');
const tarballRoot = resolve(artifactRoot, 'tarballs');
const fixtureRoot = resolve(artifactRoot, 'packed-consumer');
const packageDirectories = ['core', 'cave', 'coven', 'sdk', 'cli'];
const packageNames = {
  core: '@opencoven/sdk-core',
  cave: '@opencoven/cave-client',
  coven: '@opencoven/coven-client',
  sdk: '@opencoven/sdk',
  cli: '@opencoven/dev-cli',
};

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
  });
}

function runPnpm(args, cwd) {
  run('corepack', ['pnpm@10.34.0', ...args], cwd);
}

function findTarball(directory) {
  const tarballs = readdirSync(directory).filter((entry) => entry.endsWith('.tgz'));

  if (tarballs.length !== 1) {
    throw new Error(`Expected one tarball in ${directory}, found ${tarballs.length}.`);
  }

  return resolve(directory, tarballs[0]);
}

function readTarballFile(tarball, path) {
  return execFileSync('tar', ['-xOf', tarball, `package/${path}`], {
    encoding: 'utf8',
  });
}

function assertPackedLicense(tarball, packageDirectory) {
  const manifest = JSON.parse(readTarballFile(tarball, 'package.json'));
  const selector = readTarballFile(tarball, 'LICENSE');
  const agpl = readTarballFile(tarball, 'LICENSE-AGPL');
  const mit = readTarballFile(tarball, 'LICENSE-MIT');

  if (
    manifest.name !== packageNames[packageDirectory] ||
    manifest.license !== 'AGPL-3.0-or-later OR MIT' ||
    !selector.includes('OpenCoven SDK') ||
    selector.includes('coven-cave') ||
    !agpl.includes('GNU AFFERO GENERAL PUBLIC LICENSE') ||
    !mit.startsWith('MIT License\n')
  ) {
    throw new Error(`Packed ${packageDirectory} package has inaccurate license metadata or text.`);
  }
}

function createFixture(tarballs) {
  mkdirSync(resolve(fixtureRoot, 'src'), { recursive: true });
  writeFileSync(
    resolve(fixtureRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'packed-opencoven-consumer',
        private: true,
        type: 'module',
        dependencies: {
          '@opencoven/sdk-core': `file:${tarballs.core}`,
          '@opencoven/cave-client': `file:${tarballs.cave}`,
          '@opencoven/coven-client': `file:${tarballs.coven}`,
          '@opencoven/sdk': `file:${tarballs.sdk}`,
          '@opencoven/dev-cli': `file:${tarballs.cli}`,
        },
        pnpm: {
          overrides: {
            '@opencoven/sdk-core': `file:${tarballs.core}`,
            '@opencoven/cave-client': `file:${tarballs.cave}`,
            '@opencoven/coven-client': `file:${tarballs.coven}`,
          },
        },
        devDependencies: {
          typescript: '6.0.3',
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    resolve(fixtureRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2024',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    resolve(fixtureRoot, 'src', 'index.ts'),
    `import { CaveClient } from '@opencoven/cave-client';
import { COVEN_DAEMON_PROTOCOL, CovenClient } from '@opencoven/coven-client';
import { formatCliOutput } from '@opencoven/dev-cli';
import { createMemorySecretStore } from '@opencoven/sdk-core';
import { createOpenCovenSdk } from '@opencoven/sdk';

const cave = new CaveClient({
  transport: {
    health: async () => ({ data: { status: 'ok' } }),
  },
});
const coven = new CovenClient({
  transport: {
    health: async () => ({
      ok: true,
      apiVersion: COVEN_DAEMON_PROTOCOL,
      covenVersion: '0.1.0',
      capabilities: {
        sessions: true,
        events: true,
        eventCursor: 'sequence',
        structuredErrors: true,
      },
    }),
  },
});
const sdk = createOpenCovenSdk({ cave, coven });
const store = createMemorySecretStore();

await store.set('token', 'in-memory');
void sdk;
void formatCliOutput;
`,
  );
  writeFileSync(
    resolve(fixtureRoot, 'verify.mjs'),
    `await import('@opencoven/sdk-core');
await import('@opencoven/cave-client');
await import('@opencoven/coven-client');
await import('@opencoven/sdk');
await import('@opencoven/dev-cli');

try {
  await import('@opencoven/sdk-core/src/errors.js');
  throw new Error('Deep import unexpectedly succeeded.');
} catch (error) {
  if (error && typeof error === 'object' && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
    process.exit(0);
  }

  throw error;
}
`,
  );
}

try {
  rmSync(artifactRoot, { force: true, recursive: true });
  mkdirSync(tarballRoot, { recursive: true });

  runPnpm(['--recursive', '--filter', './packages/*', 'build'], root);

  const tarballs = {};
  for (const packageDirectory of packageDirectories) {
    const destination = resolve(tarballRoot, packageDirectory);
    mkdirSync(destination, { recursive: true });
    runPnpm(['pack', '--pack-destination', destination], resolve(root, 'packages', packageDirectory));
    tarballs[packageDirectory] = findTarball(destination);
    assertPackedLicense(tarballs[packageDirectory], packageDirectory);
  }

  process.stdout.write('Packed license metadata verified.\n');
  createFixture(tarballs);
  runPnpm(['--ignore-workspace', 'install', '--offline', '--ignore-scripts'], fixtureRoot);
  runPnpm(['--ignore-workspace', 'exec', 'tsc', '--pretty', 'false'], fixtureRoot);

  for (const packageDirectory of packageDirectories) {
    const packageName = packageDirectory === 'core' ? 'sdk-core' : packageDirectory === 'cli' ? 'dev-cli' : `${packageDirectory}-client`;
    if (packageDirectory === 'sdk') {
      continue;
    }

    if (existsSync(resolve(fixtureRoot, 'node_modules', '@opencoven', packageName, 'src'))) {
      throw new Error(`Packed ${packageDirectory} package unexpectedly contains source files.`);
    }
  }

  run(process.execPath, ['verify.mjs'], fixtureRoot);
  run(resolve(fixtureRoot, 'node_modules', '.bin', 'opencoven'), ['--json', '--help'], fixtureRoot);
  process.stdout.write('Packed package verification passed.\n');
} finally {
  rmSync(artifactRoot, { force: true, recursive: true });
}
