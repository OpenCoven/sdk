import {
  createCovenClient,
  createCovenUnixTransport,
  createCovenWindowsTransport,
  type CovenDiscoveredEndpoint,
  type CovenHealthResponse,
} from '@opencoven/coven-client';

import type { CliCommandResult, ResolvedCliRuntime } from './main.js';
import { normalizeCliError, type CliOutput } from './output.js';

function unixPeerIdentity(): { uid: number } {
  const uid = process.geteuid?.();
  if (!Number.isSafeInteger(uid) || (uid as number) < 0) {
    throw new Error('Current effective user could not be identified.');
  }

  return { uid: uid as number };
}

function windowsIdentity(discovered: CovenDiscoveredEndpoint) {
  const ownerIdentity =
    discovered.owner?.kind === 'windows'
      ? discovered.owner.identity
      : 'S-1-5-18';

  return {
    ownerIdentity,
    ownerOnly: true,
    pipeIdentity: discovered.endpoint.path,
    serverProcessId: discovered.freshness?.daemonPid ?? 1,
    processCreationTime:
      discovered.freshness?.processCreationTime ??
      discovered.freshness?.daemonStartedAt ??
      '1970-01-01T00:00:00Z',
  };
}

export async function readDiscoveredCovenHealth(
  discovered: CovenDiscoveredEndpoint,
): Promise<CovenHealthResponse> {
  const rawTransport =
    discovered.endpoint.kind === 'unix'
      ? createCovenUnixTransport(discovered, {
          security: {
            platform: 'unix',
            peerIdentity: {
              inspectConnected: () => Promise.resolve(unixPeerIdentity()),
            },
          },
        })
      : createCovenWindowsTransport(discovered, {
          security: {
            platform: 'windows',
            ownership: {
              currentUserIdentity: () => Promise.resolve(windowsIdentity(discovered).ownerIdentity),
              inspect: () => Promise.resolve(windowsIdentity(discovered)),
              inspectConnected: () => Promise.resolve(windowsIdentity(discovered)),
            },
          },
        });

  let response: CovenHealthResponse | undefined;
  const client = createCovenClient({
    transport: {
      health: async (context) => {
        response = await rawTransport.health(context);
        return response;
      },
    },
  });

  await client.health();

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
  let discovered: CovenDiscoveredEndpoint;

  try {
    discovered = await runtime.coven.discoverEndpoint(runtime.discoveryOptions.coven);
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
    const response = await runtime.coven.readHealth(discovered);
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
