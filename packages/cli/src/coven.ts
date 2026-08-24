import {
  CovenIpcError,
  createCovenClient,
  createCovenUnixTransport,
  createCovenWindowsTransport,
  type CovenDiscoveredEndpoint,
  type CovenDiscoveredUnixTransportOptions,
  type CovenDiscoveredWindowsTransportOptions,
  type CovenHealthResponse,
  type CovenTransport,
  type CovenTransportSecurityProvider,
} from '@opencoven/coven-client';
import type { OperationOptions } from '@opencoven/sdk-core';

import {
  createCliDeadline,
  runWithinCliDeadline,
} from './command-timing.js';
import type { CliCommandResult, ResolvedCliRuntime } from './main.js';
import { normalizeCliError, type CliOutput } from './output.js';

export interface ReadDiscoveredCovenHealthOptions extends OperationOptions {
  transportSecurity?: CovenTransportSecurityProvider;
  unix?: CovenDiscoveredUnixTransportOptions;
  windows?: CovenDiscoveredWindowsTransportOptions;
}

function platformSecurityUnavailable(
  discovered: CovenDiscoveredEndpoint,
): Error {
  const platform = discovered.endpoint.kind === 'unix' ? 'unix' : 'windows';
  const requirement =
    discovered.endpoint.kind === 'unix'
      ? 'peer_identity'
      : 'pipe_ownership';

  return Object.assign(
    new Error(
      discovered.endpoint.kind === 'unix'
        ? 'Coven Unix peer-identity security provider was unavailable.'
        : 'Coven Windows pipe-ownership security provider was unavailable.',
    ),
    {
      code: 'platform_security_unavailable',
      retryable: false,
      diagnostics: {
        phase: 'validate_endpoint',
        platform,
        requirement,
      },
    },
  );
}

function createDiscoveredHealthTransport(
  discovered: CovenDiscoveredEndpoint,
  options: ReadDiscoveredCovenHealthOptions,
): CovenTransport {
  const { transportSecurity } = options;

  if (discovered.endpoint.kind === 'unix') {
    if (transportSecurity === undefined) {
      throw platformSecurityUnavailable(discovered);
    }
    if (transportSecurity.platform !== 'unix') {
      throw new CovenIpcError(
        'unsafe_endpoint',
        'Unix transport security is required for the discovered endpoint.',
        { phase: 'validate_endpoint' },
      );
    }

    return createCovenUnixTransport(discovered, {
      ...options.unix,
      security: transportSecurity,
    });
  }

  if (transportSecurity === undefined) {
    throw platformSecurityUnavailable(discovered);
  }
  if (transportSecurity.platform !== 'windows') {
    throw new CovenIpcError(
      'unsafe_endpoint',
      'Windows transport security is required for the discovered endpoint.',
      { phase: 'validate_endpoint' },
    );
  }

  return createCovenWindowsTransport(discovered, {
    ...options.windows,
    security: transportSecurity,
  });
}

export async function readDiscoveredCovenHealth(
  discovered: CovenDiscoveredEndpoint,
  options: ReadDiscoveredCovenHealthOptions = {},
): Promise<CovenHealthResponse> {
  const rawTransport = createDiscoveredHealthTransport(discovered, options);
  const operationOptions: OperationOptions = {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.observer === undefined ? {} : { observer: options.observer }),
  };

  let response: CovenHealthResponse | undefined;
  const client = createCovenClient({
    transport: {
      health: async (context) => {
        response = await rawTransport.health(context);
        return response;
      },
    },
  });

  await client.health(operationOptions);

  if (response === undefined) {
    throw new Error('Coven daemon health response was unavailable.');
  }

  return response;
}

function renderCovenHealthHuman(output: CliOutput): readonly string[] {
  if (output.ok) {
    const discovery = output.data?.discovery as Record<string, unknown> | undefined;
    const endpoint = discovery?.endpoint as Record<string, unknown> | undefined;
    const health = output.data?.health as Record<string, unknown> | undefined;
    const endpointPath = typeof endpoint?.path === 'string' ? endpoint.path : 'unknown';
    const covenVersion = typeof health?.covenVersion === 'string' ? health.covenVersion : 'unknown';

    return [
      'Coven health: ok',
      `Endpoint: ${endpointPath}`,
      `Version: ${covenVersion}`,
    ];
  }

  const lines = ['Coven health: failed', output.error?.message ?? 'Coven health failed.'];
  if (output.error?.action !== undefined) {
    lines.push(`Action: ${output.error.action}`);
  }
  return lines;
}

export async function runCovenHealth(runtime: ResolvedCliRuntime): Promise<CliCommandResult> {
  const deadline = createCliDeadline(runtime.now, runtime.timing.covenHealthTimeoutMs);
  let discovered: CovenDiscoveredEndpoint;

  try {
    discovered = await runWithinCliDeadline(
      runtime.now,
      deadline,
      'coven health',
      async (timeoutMs) =>
        await runtime.coven.discoverEndpoint({
          ...runtime.discoveryOptions.coven,
          timeoutMs,
        }),
    );
  } catch (error) {
    const output: CliOutput = {
      command: 'coven health',
      error: normalizeCliError(error, {
        system: 'coven',
        operation: 'discover',
      }),
      human: renderCovenHealthHuman({
        command: 'coven health',
        error: normalizeCliError(error, {
          system: 'coven',
          operation: 'discover',
        }),
        ok: false,
        version: runtime.version,
      }),
      ok: false,
      version: runtime.version,
    };

    return { exitCode: 1, output };
  }

  try {
    const response = await runWithinCliDeadline(
      runtime.now,
      deadline,
      'coven health',
      async (timeoutMs) =>
        await runtime.coven.readHealth(discovered, { timeoutMs }),
    );
    const output: CliOutput = {
      command: 'coven health',
      data: {
        discovery: discovered,
        health: {
          status: 'ok',
          covenVersion: response.covenVersion,
          capabilities: response.capabilities,
        },
      },
      human: renderCovenHealthHuman({
        command: 'coven health',
        data: {
          discovery: discovered,
          health: {
            status: 'ok',
            covenVersion: response.covenVersion,
            capabilities: response.capabilities,
          },
        },
        ok: true,
        version: runtime.version,
      }),
      ok: true,
      version: runtime.version,
    };

    return { exitCode: 0, output };
  } catch (error) {
    const normalized = normalizeCliError(error, {
      system: 'coven',
      operation: 'health',
    });
    const output: CliOutput = {
      command: 'coven health',
      data: {
        discovery: discovered,
      },
      error: normalized,
      human: renderCovenHealthHuman({
        command: 'coven health',
        data: { discovery: discovered },
        error: normalized,
        ok: false,
        version: runtime.version,
      }),
      ok: false,
      version: runtime.version,
    };

    return { exitCode: 1, output };
  }
}
