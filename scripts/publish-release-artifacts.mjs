#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  verifyPublicationSecurityReview,
} from './github-release-authorization.mjs';
import {
  verifyProtectedApprovalArtifacts,
} from './github-environment-approval-evidence.mjs';
import {
  cleanupOwnedTempRoot,
  createOwnedTempDirectory,
} from './owned-temp-directory.mjs';
import { PUBLIC_PACKAGES } from './repository-metadata.mjs';
import { readReleaseConfig } from './release-readiness.mjs';
import {
  AUTHENTICATED_NPM_CLI_VERSION,
  AUTHENTICATED_NPM_TARBALL_URL,
  createSterileReleaseEnvironment,
  resolveAuthenticatedReleaseRuntime,
  verifyAuthenticatedNpmCliTree,
  verifyAuthenticatedNpmTarball,
} from './release-runtime-integrity.mjs';

const CANONICAL_NPM_REGISTRY = 'https://registry.npmjs.org/';
const PUBLISHER_NPM_VERSION = AUTHENTICATED_NPM_CLI_VERSION;
const MAX_NPM_TARBALL_BYTES = 32 * 1024 * 1024;

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createNpmPublishArgs({
  tarball,
  access,
  distTag,
  registry,
  userconfig,
  globalconfig,
  cache,
}) {
  if (typeof tarball !== 'string' || tarball.length === 0) {
    throw new Error('tarball must be a non-empty string');
  }
  if (access !== 'public' && access !== 'restricted') {
    throw new Error('access must be public or restricted');
  }
  if (typeof distTag !== 'string' || distTag.length === 0) {
    throw new Error('distTag must be a non-empty string');
  }
  for (const [value, label] of [
    [registry, 'registry'],
    [userconfig, 'userconfig'],
    [globalconfig, 'globalconfig'],
    [cache, 'cache'],
  ]) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`${label} must be a non-empty string`);
    }
  }

  return [
    'publish',
    tarball,
    '--access',
    access,
    '--tag',
    distTag,
    '--provenance',
    '--ignore-scripts',
    `--registry=${registry}`,
    `--userconfig=${userconfig}`,
    `--globalconfig=${globalconfig}`,
    `--cache=${cache}`,
  ];
}

function validateOidcRequestEnvironment(env) {
  const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  let parsed;
  try {
    parsed = new URL(requestUrl);
  } catch (error) {
    throw new Error(
      'GitHub OIDC request URL is required for npm trusted publishing',
      { cause: error },
    );
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username.length !== 0
    || parsed.password.length !== 0
    || parsed.port.length !== 0
    || !parsed.hostname.endsWith('.actions.githubusercontent.com')
    || typeof requestToken !== 'string'
    || requestToken.length === 0
  ) {
    throw new Error(
      'GitHub OIDC request variables are invalid for npm trusted publishing',
    );
  }
  return { requestUrl, requestToken };
}

function validateGitHubPublishProvenance(env, manifest, trustedPublisher) {
  const expectedWorkflowRef =
    `${manifest.provenance.repository}/${manifest.provenance.workflow}`
    + `@${manifest.provenance.sourceRef}`;
  if (
    env.GITHUB_SERVER_URL !== 'https://github.com'
    || env.GITHUB_REPOSITORY !== 'OpenCoven/sdk'
    || env.GITHUB_WORKFLOW_REF !== expectedWorkflowRef
    || env.GITHUB_WORKFLOW_SHA !== manifest.source.commit
    || env.GITHUB_REF !== manifest.provenance.sourceRef
    || env.GITHUB_SHA !== manifest.source.commit
    || trustedPublisher.repository !== env.GITHUB_REPOSITORY
    || trustedPublisher.workflow !== 'release.yml'
    || env.GITHUB_JOB !== trustedPublisher.job
    || env.OPENCOVEN_NPM_PUBLISH_ENVIRONMENT
      !== trustedPublisher.environment
    || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_REPOSITORY_ID !== '1337664127'
    || env.GITHUB_REPOSITORY_OWNER_ID !== '270919577'
    || env.RUNNER_ENVIRONMENT !== 'github-hosted'
    || typeof env.GITHUB_RUN_ID !== 'string'
    || !/^[1-9]\d*$/u.test(env.GITHUB_RUN_ID)
    || env.GITHUB_RUN_ID === manifest.provenance.runId
    || typeof env.GITHUB_RUN_ATTEMPT !== 'string'
    || !/^[1-9]\d*$/u.test(env.GITHUB_RUN_ATTEMPT)
  ) {
    throw new Error(
      'GitHub publish provenance does not match the exact authorized release workflow',
    );
  }
  return {
    serverUrl: env.GITHUB_SERVER_URL,
    repository: env.GITHUB_REPOSITORY,
    workflowRef: env.GITHUB_WORKFLOW_REF,
    ref: env.GITHUB_REF,
    sha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    eventName: env.GITHUB_EVENT_NAME,
    repositoryId: env.GITHUB_REPOSITORY_ID,
    repositoryOwnerId: env.GITHUB_REPOSITORY_OWNER_ID,
    runnerEnvironment: env.RUNNER_ENVIRONMENT,
  };
}

function createSterileNpmContext(
  env,
  registry,
  manifest,
  runtime,
  trustedPublisher,
) {
  const provenance = validateGitHubPublishProvenance(
    env,
    manifest,
    trustedPublisher,
  );
  const owned = createOwnedTempDirectory({
    prefix: 'opencoven-sdk-npm-publish',
    childSegments: ['publish'],
  });
  const home = resolve(owned.path, 'home');
  const cache = resolve(owned.path, 'cache');
  const temporary = resolve(owned.path, 'tmp');
  const tarballs = resolve(owned.path, 'tarballs');
  for (const directory of [home, cache, temporary, tarballs]) {
    mkdirSync(directory, { mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  const userconfig = resolve(owned.path, 'user.npmrc');
  const globalconfig = resolve(owned.path, 'global.npmrc');
  const configText = `registry=${registry}\n`;
  writeFileSync(userconfig, configText, { flag: 'wx', mode: 0o600 });
  writeFileSync(globalconfig, configText, { flag: 'wx', mode: 0o600 });

  const baseEnvironment = {
    ...createSterileReleaseEnvironment({
      authenticatedNodePath: runtime.nodePath,
      home,
      temporary,
      corepackHome: resolve(owned.path, 'corepack'),
      include: {
        CI: 'true',
      },
    }),
    NPM_CONFIG_USERCONFIG: userconfig,
    NPM_CONFIG_GLOBALCONFIG: globalconfig,
    NPM_CONFIG_CACHE: cache,
    NPM_CONFIG_REGISTRY: registry,
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: provenance.serverUrl,
    GITHUB_REPOSITORY: provenance.repository,
    GITHUB_WORKFLOW_REF: provenance.workflowRef,
    GITHUB_REF: provenance.ref,
    GITHUB_SHA: provenance.sha,
    GITHUB_RUN_ID: provenance.runId,
    GITHUB_RUN_ATTEMPT: provenance.runAttempt,
    GITHUB_EVENT_NAME: provenance.eventName,
    GITHUB_REPOSITORY_ID: provenance.repositoryId,
    GITHUB_REPOSITORY_OWNER_ID: provenance.repositoryOwnerId,
    RUNNER_ENVIRONMENT: provenance.runnerEnvironment,
  };
  return {
    owned,
    cwd: owned.path,
    tarballs,
    userconfig,
    globalconfig,
    cache,
    verificationEnv: baseEnvironment,
  };
}

export function prepareAuthenticatedNpmCli({
  version,
  registry,
  runtime,
  execute = execFileSync,
}) {
  if (
    version !== AUTHENTICATED_NPM_CLI_VERSION
    || registry !== CANONICAL_NPM_REGISTRY
  ) {
    throw new Error('Authenticated npm CLI request is not canonical');
  }
  const owned = createOwnedTempDirectory({
    prefix: 'opencoven-sdk-npm-cli',
    childSegments: ['distribution'],
  });
  try {
    const home = resolve(owned.path, 'home');
    const temporary = resolve(owned.path, 'tmp');
    const corepackHome = resolve(owned.path, 'corepack');
    const extractRoot = resolve(owned.path, 'extract');
    for (const directory of [home, temporary, corepackHome, extractRoot]) {
      mkdirSync(directory, { mode: 0o700 });
      chmodSync(directory, 0o700);
    }
    const environment = createSterileReleaseEnvironment({
      authenticatedNodePath: runtime.nodePath,
      home,
      temporary,
      corepackHome,
      include: {
        CI: 'true',
      },
    });
    const tarballPath = resolve(owned.path, 'npm-11.5.1.tgz');
    execute(
      '/usr/bin/curl',
      [
        '--fail',
        '--silent',
        '--show-error',
        '--proto',
        '=https',
        '--tlsv1.2',
        '--output',
        tarballPath,
        AUTHENTICATED_NPM_TARBALL_URL,
      ],
      {
        cwd: owned.path,
        env: environment,
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: 120_000,
        killSignal: 'SIGKILL',
      },
    );
    const tarballBytes = readFileSync(tarballPath);
    if (tarballBytes.byteLength > MAX_NPM_TARBALL_BYTES) {
      throw new Error('Authenticated npm tarball exceeds the maximum size');
    }
    verifyAuthenticatedNpmTarball(tarballBytes);
    const listing = execute(
      '/usr/bin/tar',
      ['-tzf', tarballPath],
      {
        cwd: owned.path,
        env: environment,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
        killSignal: 'SIGKILL',
      },
    );
    const entries = listing
      .split('\n')
      .filter((entry) => entry.length > 0);
    if (
      entries.length !== 2293
      || new Set(entries).size !== entries.length
      || entries.some(
        (entry) =>
          !entry.startsWith('package/')
          || entry.startsWith('/')
          || entry.includes('\\')
          || entry.split('/').includes('..'),
      )
    ) {
      throw new Error('Authenticated npm tarball contains an unsafe file list');
    }
    execute(
      '/usr/bin/tar',
      [
        '-xzf',
        tarballPath,
        '-C',
        extractRoot,
        '--no-same-owner',
        '--no-same-permissions',
      ],
      {
        cwd: owned.path,
        env: environment,
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: 30_000,
        killSignal: 'SIGKILL',
      },
    );
    const npmRoot = resolve(extractRoot, 'package');
    const verified = verifyAuthenticatedNpmCliTree({
      root: npmRoot,
      version,
    });
    return {
      owned,
      cliPath: verified.cliPath,
      treeSha256: verified.treeSha256,
    };
  } catch (error) {
    cleanupOwnedTempRoot(owned);
    throw error;
  }
}

function runNpm(
  execute,
  runtime,
  npmCli,
  args,
  context,
  environment,
  capture = false,
) {
  return execute(runtime.nodePath, [npmCli, ...args], {
    cwd: context.cwd,
    env: environment,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture
      ? ['ignore', 'pipe', 'pipe']
      : 'inherit',
  });
}

function assertCanonicalResolvedNpmConfig(
  execute,
  runtime,
  npmCli,
  context,
  registry,
) {
  const output = runNpm(
    execute,
    runtime,
    npmCli,
    [
      'config',
      'list',
      '--json',
      `--registry=${registry}`,
      `--userconfig=${context.userconfig}`,
      `--globalconfig=${context.globalconfig}`,
      `--cache=${context.cache}`,
    ],
    context,
    context.verificationEnv,
    true,
  );
  let config;
  try {
    config = JSON.parse(output);
  } catch (error) {
    throw new Error('Resolved npm configuration is not valid JSON', {
      cause: error,
    });
  }
  if (
    config.registry !== registry
    || config.userconfig !== context.userconfig
    || config.globalconfig !== context.globalconfig
    || config.cache !== context.cache
  ) {
    throw new Error(
      `Resolved npm registry must be ${CANONICAL_NPM_REGISTRY} with sterile config paths`,
    );
  }
  for (const [key, value] of Object.entries(config)) {
    const normalized = key.toLowerCase().replaceAll('_', '-');
    const tokenFallback =
      normalized === '-auth'
      || normalized === '-authtoken'
      || normalized === 'token'
      || normalized === 'username'
      || normalized === '-password'
      || normalized.endsWith(':-auth')
      || normalized.endsWith(':-authtoken')
      || normalized.endsWith(':username')
      || normalized.endsWith(':-password');
    if (
      tokenFallback
      || (
        ['proxy', 'https-proxy', 'cafile'].includes(normalized)
        && value !== null
        && value !== undefined
        && value !== ''
      )
      || (normalized === 'strict-ssl' && value === false)
      || (normalized === 'always-auth' && value !== false)
    ) {
      throw new Error(
        'Resolved npm configuration contains authentication or transport fallback',
      );
    }
  }
}

function copyAuthorizedTarball(entry, artifactRoot, context) {
  const source = resolve(artifactRoot, entry.file);
  const destination = resolve(context.tarballs, entry.file.split('/').at(-1));
  const sourceBytes = readFileSync(source);
  if (
    sourceBytes.byteLength !== entry.size
    || digest(sourceBytes) !== entry.sha256
  ) {
    throw new Error(`${entry.name} changed after authorization verification`);
  }
  copyFileSync(source, destination, constants.COPYFILE_EXCL);
  chmodSync(destination, 0o600);
  const destinationStats = lstatSync(destination);
  const destinationBytes = readFileSync(destination);
  if (
    destinationStats.isSymbolicLink()
    || !destinationStats.isFile()
    || destinationBytes.byteLength !== entry.size
    || digest(destinationBytes) !== entry.sha256
  ) {
    throw new Error(`${entry.name} changed while entering the sterile publish root`);
  }
  return destination;
}

export function publishReleaseArtifacts({
  root = process.cwd(),
  artifactRoot,
  attestationRoot,
  pendingApprovalRoot,
  protectedApprovalRoot,
  version,
  env = process.env,
  execute = execFileSync,
  githubExecute = execFileSync,
  resolveRuntime = resolveAuthenticatedReleaseRuntime,
  prepareNpmCli = prepareAuthenticatedNpmCli,
} = {}) {
  if (env.OPENCOVEN_RELEASE_AUTHORIZATION !== 'publish') {
    throw new Error('OPENCOVEN_RELEASE_AUTHORIZATION must be publish');
  }
  if (env.NPM_TOKEN !== undefined || env.NODE_AUTH_TOKEN !== undefined) {
    throw new Error(
      'Token-based npm authentication is forbidden for regular releases',
    );
  }
  const config = readReleaseConfig(root);
  if (config.publishingEnabled !== true) {
    throw new Error('Release publishing is disabled by release.config.json');
  }
  const commentId = env.OPENCOVEN_SECURITY_REVIEW_COMMENT_ID;
  if (typeof commentId !== 'string' || !/^[1-9]\d*$/u.test(commentId)) {
    throw new Error(
      'OPENCOVEN_SECURITY_REVIEW_COMMENT_ID must identify the exact #40 authorization',
    );
  }
  if (
    config.npmRegistry !== CANONICAL_NPM_REGISTRY
    || config.npmCliVersion !== PUBLISHER_NPM_VERSION
  ) {
    throw new Error('Release npm registry and CLI version are not canonical');
  }
  const runtime = resolveRuntime({ env });
  const { authorization, manifest } = verifyPublicationSecurityReview({
    root,
    artifactRoot,
    attestationRoot,
    commentId,
    execute: githubExecute,
    env,
    allowedArtifactRoots: [
      artifactRoot,
      attestationRoot,
      pendingApprovalRoot,
      protectedApprovalRoot,
    ],
  });
  if (
    manifest.toolchain.nodeVersion !== runtime.nodeVersion
    || manifest.toolchain.nodePath !== runtime.nodePath
    || manifest.toolchain.nodeSize !== runtime.nodeSize
    || manifest.toolchain.nodeSha256 !== runtime.nodeSha256
  ) {
    throw new Error(
      'Authenticated Node runtime does not match the reviewed publication toolchain',
    );
  }
  verifyProtectedApprovalArtifacts({
    root,
    pendingRoot: pendingApprovalRoot,
    approvalRoot: protectedApprovalRoot,
    securityReview: authorization,
    execute: githubExecute,
    env,
  });
  if (version !== undefined && manifest.version !== version) {
    throw new Error(`Publication manifest version must be ${version}`);
  }

  const preparedNpm = prepareNpmCli({
    version: config.npmCliVersion,
    registry: config.npmRegistry,
    runtime,
    execute,
  });
  if (
    preparedNpm.treeSha256 !== config.npmCliDistribution.treeSha256
    || manifest.toolchain.npmTreeSha256 !== preparedNpm.treeSha256
  ) {
    cleanupOwnedTempRoot(preparedNpm.owned);
    throw new Error(
      'Authenticated npm CLI tree does not match the reviewed publication toolchain',
    );
  }
  let context;
  try {
    context = createSterileNpmContext(
      env,
      config.npmRegistry,
      manifest,
      runtime,
      config.npmTrustedPublisher,
    );
    const npmVersion = runNpm(
      execute,
      runtime,
      preparedNpm.cliPath,
      ['--version'],
      context,
      context.verificationEnv,
      true,
    ).trim();
    if (npmVersion !== config.npmCliVersion) {
      throw new Error(
        `Reviewed npm CLI must report exactly ${config.npmCliVersion}`,
      );
    }
    assertCanonicalResolvedNpmConfig(
      execute,
      runtime,
      preparedNpm.cliPath,
      context,
      config.npmRegistry,
    );
    const oidc = validateOidcRequestEnvironment(env);
    const publishEnvironment = {
      ...context.verificationEnv,
      ACTIONS_ID_TOKEN_REQUEST_URL: oidc.requestUrl,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: oidc.requestToken,
    };
    for (const packageMetadata of PUBLIC_PACKAGES) {
      const entry = manifest.packages.find(
        ({ name }) => name === packageMetadata.packageName,
      );
      if (entry === undefined) {
        throw new Error(
          `Missing release artifact for ${packageMetadata.packageName}`,
        );
      }
      const tarball = copyAuthorizedTarball(
        entry,
        artifactRoot,
        context,
      );
      runNpm(
        execute,
        runtime,
        preparedNpm.cliPath,
        createNpmPublishArgs({
          tarball,
          access: config.npmAccess,
          distTag: config.npmDistTag,
          registry: config.npmRegistry,
          userconfig: context.userconfig,
          globalconfig: context.globalconfig,
          cache: context.cache,
        }),
        context,
        publishEnvironment,
      );
    }
  } finally {
    if (context !== undefined) {
      cleanupOwnedTempRoot(context.owned);
    }
    cleanupOwnedTempRoot(preparedNpm.owned);
  }

  return manifest;
}

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (index === 0 && argument === '--') {
      continue;
    }
    const key =
      argument === '--artifact-root'
        ? 'artifactRoot'
        : argument === '--attestation-root'
          ? 'attestationRoot'
          : argument === '--pending-approval-root'
            ? 'pendingApprovalRoot'
            : argument === '--protected-approval-root'
              ? 'protectedApprovalRoot'
              : argument === '--version'
                ? 'version'
                : undefined;
    if (key === undefined) {
      throw new Error(`Unknown option ${argument}`);
    }
    if (options[key] !== undefined) {
      throw new Error(`Option ${argument} may only be provided once`);
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Option ${argument} requires a value`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

export function main(arguments_ = process.argv.slice(2)) {
  return publishReleaseArtifacts({
    root: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    ...parseArguments(arguments_),
  });
}

if (
  process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
