import {
  createDiscoveredCaveClient,
  type CaveCredentialStatus,
  type CaveDiscoveredClientOptions,
  type CaveDiscoveredEndpoint,
  type CaveHealth,
  type CaveCredentialMetadata,
  type CavePairingRequest,
  type CavePairingStatus,
} from '@opencoven/cave-client';
import {
  type CovenDiscoveredUnixTransportOptions,
  type CovenDiscoveredWindowsTransportOptions,
  discoverCovenEndpoint,
  type CovenDiscoveredEndpoint,
  type CovenHealthResponse,
  type CovenTransportSecurityProvider,
  type DiscoverCovenEndpointOptions,
} from '@opencoven/coven-client';
import {
  createSecretStoreReference,
  type OperationOptions,
  type SecretStore,
} from '@opencoven/sdk-core';

import { runCaveCommand } from './cave.js';
import { createDefaultCliCaveDiscoverEndpoint } from './cave-platform-security.js';
import {
  resolveCliCommandTiming,
  type CliCommandTiming,
} from './command-timing.js';
import { runCovenHealth, readDiscoveredCovenHealth } from './coven.js';
import { runDiscover } from './discover.js';
import { runDoctor } from './doctor.js';
import { NATIVE_SECRET_STORE_SERVICE } from './credentials.js';
import { createNativeSecretStore } from './native-secret-store.js';
import { createCliError, formatCliOutput, type CliOutput } from './output.js';
import { DEV_CLI_VERSION } from './version.js';

export const CLI_USAGE = [
  'opencoven [--help] [--version] [--json]',
  'opencoven doctor [--json]',
  'opencoven discover [--json]',
  'opencoven cave pair [--json]',
  'opencoven cave status [--json]',
  'opencoven cave forget [--json]',
  'opencoven coven health [--json]',
] as const;

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CaveCliPairingSession {
  requestId: string;
  expiresAt: number;
  poll(options?: unknown): Promise<CavePairingStatus>;
  exchange(options?: unknown): Promise<CaveCredentialMetadata>;
}

export interface CaveCliClient {
  health(options?: unknown): Promise<CaveHealth>;
  createPairing(request: CavePairingRequest, options?: unknown): Promise<CaveCliPairingSession>;
  credentialStatus(options?: unknown): Promise<CaveCredentialStatus>;
  forgetCredential(options?: unknown): Promise<boolean>;
}

export interface CliRuntime {
  cwd?: string;
  env?: Readonly<NodeJS.ProcessEnv>;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timing?: Partial<CliCommandTiming>;
  createSecretStore?: () => Promise<SecretStore> | SecretStore;
  createSecretStoreReference?: typeof createSecretStoreReference;
  cave?: {
    discovery?: CaveDiscoveredClientOptions['discovery'];
    discoverEndpoint?: (
      options?: CaveDiscoveredClientOptions['discovery'],
    ) => Promise<CaveDiscoveredEndpoint>;
    createClient?: (
      options: CaveDiscoveredClientOptions,
    ) => Promise<CaveCliClient> | CaveCliClient;
  };
  coven?: {
    discoverEndpoint?: (
      options?: DiscoverCovenEndpointOptions,
    ) => Promise<CovenDiscoveredEndpoint>;
    readHealth?: (
      discovered: CovenDiscoveredEndpoint,
      options?: OperationOptions,
    ) => Promise<CovenHealthResponse>;
    transportSecurity?: CovenTransportSecurityProvider;
    transport?: {
      unix?: CovenDiscoveredUnixTransportOptions;
      windows?: CovenDiscoveredWindowsTransportOptions;
    };
  };
  platform?: NodeJS.Platform;
}

export interface CliCommandResult {
  exitCode: number;
  output: CliOutput;
}

export interface ResolvedCliRuntime {
  readonly cave: {
    readonly createClient: (
      options: CaveDiscoveredClientOptions,
    ) => Promise<CaveCliClient> | CaveCliClient;
    readonly discoverEndpoint: (
      options?: CaveDiscoveredClientOptions['discovery'],
    ) => Promise<CaveDiscoveredEndpoint>;
  };
  readonly coven: {
    readonly discoverEndpoint: (
      options?: DiscoverCovenEndpointOptions,
    ) => Promise<CovenDiscoveredEndpoint>;
    readonly readHealth: (
      discovered: CovenDiscoveredEndpoint,
      options?: OperationOptions,
    ) => Promise<CovenHealthResponse>;
  };
  readonly createSecretStore: () => Promise<SecretStore>;
  readonly createSecretStoreReference: typeof createSecretStoreReference;
  readonly cwd: string;
  readonly discoveryOptions: {
    readonly cave: CaveDiscoveredClientOptions['discovery'];
    readonly coven: DiscoverCovenEndpointOptions;
  };
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly platform: NodeJS.Platform;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly timing: CliCommandTiming;
  readonly version: string;
}

interface ParsedArguments {
  format: 'human' | 'json';
  command:
    | 'help'
    | 'version'
    | 'doctor'
    | 'discover'
    | 'cave pair'
    | 'cave status'
    | 'cave forget'
    | 'coven health';
}

interface InvalidArguments {
  command: string;
  error: CliOutput;
  format: 'human' | 'json';
  invalid: true;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function defaultFetch(): typeof fetch {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('Fetch API is unavailable in this Node.js runtime.');
  }

  return globalThis.fetch.bind(globalThis);
}

function helpOutput(): CliOutput {
  return {
    command: 'help',
    data: {
      name: 'opencoven',
      usage: CLI_USAGE,
    },
    human: [
      'OpenCoven developer CLI',
      '',
      'Usage:',
      ...CLI_USAGE.map((line) => `  ${line}`),
      '',
      'Human output is written to stdout on success and stderr on failure.',
      'JSON output is always written to stdout.',
      '',
    ],
    ok: true,
    version: DEV_CLI_VERSION,
  };
}

function versionOutput(): CliOutput {
  return {
    command: 'version',
    human: [DEV_CLI_VERSION],
    ok: true,
    version: DEV_CLI_VERSION,
  };
}

function invalidArguments(
  format: 'human' | 'json',
  command: string,
  message: string,
): InvalidArguments {
  return {
    command,
    error: {
      command,
      data: {
        usage: CLI_USAGE,
      },
      error: createCliError(
        'invalid_arguments',
        message,
        {
          action: 'Run `opencoven --help` to review the supported commands.',
        },
      ),
      human: [message, '', 'Usage:', ...CLI_USAGE.map((line) => `  ${line}`), ''],
      ok: false,
      version: DEV_CLI_VERSION,
    },
    format,
    invalid: true,
  };
}

function parseArguments(argv: readonly string[]): ParsedArguments | InvalidArguments {
  const format: 'human' | 'json' = argv.includes('--json') ? 'json' : 'human';
  let wantsHelp = false;
  let wantsVersion = false;
  const positionals: string[] = [];

  for (const argument of argv) {
    if (argument === '--json') {
      continue;
    }
    if (argument === '--help') {
      wantsHelp = true;
      continue;
    }
    if (argument === '--version') {
      wantsVersion = true;
      continue;
    }
    if (argument.startsWith('-')) {
      return invalidArguments(format, positionals.join(' ') || 'opencoven', `Unknown option "${argument}".`);
    }
    positionals.push(argument);
  }

  if (wantsHelp) {
    return { command: 'help', format };
  }

  if (wantsVersion) {
    if (positionals.length > 0) {
      return invalidArguments(format, positionals.join(' '), 'Unknown or incomplete command.');
    }
    return { command: 'version', format };
  }

  if (positionals.length === 0) {
    return { command: 'help', format };
  }

  const [first, second, third] = positionals;
  if (first === 'doctor' && second === undefined) {
    return { command: 'doctor', format };
  }
  if (first === 'discover' && second === undefined) {
    return { command: 'discover', format };
  }
  if (first === 'cave' && third === undefined) {
    if (second === 'pair') {
      return { command: 'cave pair', format };
    }
    if (second === 'status') {
      return { command: 'cave status', format };
    }
    if (second === 'forget') {
      return { command: 'cave forget', format };
    }
  }
  if (first === 'coven' && second === 'health' && third === undefined) {
    return { command: 'coven health', format };
  }

  return invalidArguments(format, positionals.join(' '), 'Unknown or incomplete command.');
}

function createResult(output: CliOutput, format: 'human' | 'json', exitCode: number): CliRunResult {
  const rendered = formatCliOutput(output, format);

  return {
    exitCode,
    stdout: format === 'human' && !output.ok ? '' : rendered,
    stderr: format === 'human' && !output.ok ? rendered : '',
  };
}

function resolveRuntime(runtime: CliRuntime = {}): ResolvedCliRuntime {
  const resolvedFetch = runtime.fetch ?? defaultFetch();
  const createStore = runtime.createSecretStore ??
    (() => createNativeSecretStore({ service: NATIVE_SECRET_STORE_SERVICE }));
  const platform = runtime.platform ?? process.platform;
  const caveDiscoveryDefaults = runtime.cave?.discovery ?? {};
  const caveDiscoveryOptions = {
    ...caveDiscoveryDefaults,
    cwd: runtime.cwd ?? process.cwd(),
    env: runtime.env ?? process.env,
    platform,
  };
  const covenDiscoveryOptions = {
    cwd: runtime.cwd ?? process.cwd(),
    env: runtime.env ?? process.env,
    platform,
  };
  const covenTransportSecurity = runtime.coven?.transportSecurity;
  const covenTransport = runtime.coven?.transport;

  return {
    cave: {
      createClient: runtime.cave?.createClient ?? createDiscoveredCaveClient,
      discoverEndpoint: runtime.cave?.discoverEndpoint ?? createDefaultCliCaveDiscoverEndpoint(),
    },
    coven: {
      discoverEndpoint: runtime.coven?.discoverEndpoint ?? discoverCovenEndpoint,
      readHealth: runtime.coven?.readHealth ??
        ((discovered, options) =>
          readDiscoveredCovenHealth(discovered, {
            ...options,
            ...(covenTransportSecurity === undefined
              ? {}
              : { transportSecurity: covenTransportSecurity }),
            ...(covenTransport?.unix === undefined
              ? {}
              : { unix: covenTransport.unix }),
            ...(covenTransport?.windows === undefined
              ? {}
              : { windows: covenTransport.windows }),
          })),
    },
    createSecretStore: async () => await createStore(),
    createSecretStoreReference: runtime.createSecretStoreReference ?? createSecretStoreReference,
    cwd: runtime.cwd ?? process.cwd(),
    discoveryOptions: {
      cave: caveDiscoveryOptions,
      coven: covenDiscoveryOptions,
    },
    env: runtime.env ?? process.env,
    fetch: resolvedFetch,
    now: runtime.now ?? (() => Date.now()),
    platform,
    sleep: runtime.sleep ?? delay,
    timing: resolveCliCommandTiming(runtime.timing),
    version: DEV_CLI_VERSION,
  };
}

export async function runCli(
  argv: readonly string[],
  runtime: CliRuntime = {},
): Promise<CliRunResult> {
  const parsed = parseArguments(argv);

  if ('invalid' in parsed) {
    return createResult(parsed.error, parsed.format, 1);
  }

  if (parsed.command === 'help') {
    return createResult(helpOutput(), parsed.format, 0);
  }

  if (parsed.command === 'version') {
    return createResult(versionOutput(), parsed.format, 0);
  }

  const resolvedRuntime = resolveRuntime(runtime);
  let result: CliCommandResult;

  switch (parsed.command) {
    case 'doctor':
      result = await runDoctor(resolvedRuntime);
      break;
    case 'discover':
      result = await runDiscover(resolvedRuntime);
      break;
    case 'cave pair':
      result = await runCaveCommand('pair', resolvedRuntime);
      break;
    case 'cave status':
      result = await runCaveCommand('status', resolvedRuntime);
      break;
    case 'cave forget':
      result = await runCaveCommand('forget', resolvedRuntime);
      break;
    case 'coven health':
      result = await runCovenHealth(resolvedRuntime);
      break;
  }

  return createResult(result.output, parsed.format, result.exitCode);
}

export async function main(argv: readonly string[]): Promise<number> {
  const result = await runCli(argv);

  if (result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }

  return result.exitCode;
}
