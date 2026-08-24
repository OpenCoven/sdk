import type { CaveDiscoveredEndpoint } from '@opencoven/cave-client';

import type { CliCommandResult, ResolvedCliRuntime } from './main.js';
import { createCliError, normalizeCliError, type CliOutput } from './output.js';

function publicCaveDiscovery(discovered: CaveDiscoveredEndpoint): Record<string, unknown> {
  return {
    endpoint: discovered.endpoint,
    freshness: {
      pid: discovered.freshness.pid,
      startedAt: discovered.freshness.startedAt,
    },
    record: discovered.record,
  };
}

function renderDiscoverHuman(output: CliOutput): readonly string[] {
  const lines = ['OpenCoven runtime discovery'];
  const cave = output.data?.cave as Record<string, unknown> | undefined;
  const coven = output.data?.coven as Record<string, unknown> | undefined;

  if (cave?.status === 'ok') {
    const discovery = cave.discovery as Record<string, unknown> | undefined;
    const endpoint = discovery?.endpoint as Record<string, unknown> | undefined;
    const url = typeof endpoint?.url === 'string' ? endpoint.url : 'discovered';
    lines.push(`- cave: ok — ${url}`);
  } else {
    const error = cave?.error as Record<string, unknown> | undefined;
    const message = typeof error?.message === 'string' ? error.message : 'Discovery failed.';
    lines.push(`- cave: error — ${message}`);
    if (typeof error?.action === 'string') {
      lines.push(`  action: ${error.action}`);
    }
  }

  if (coven?.status === 'ok') {
    const discovery = coven.discovery as Record<string, unknown> | undefined;
    const endpoint = discovery?.endpoint as Record<string, unknown> | undefined;
    const pathValue = typeof endpoint?.path === 'string' ? endpoint.path : 'discovered';
    lines.push(`- coven: ok — ${pathValue}`);
  } else {
    const error = coven?.error as Record<string, unknown> | undefined;
    const message = typeof error?.message === 'string' ? error.message : 'Discovery failed.';
    lines.push(`- coven: error — ${message}`);
    if (typeof error?.action === 'string') {
      lines.push(`  action: ${error.action}`);
    }
  }

  return lines;
}

export async function runDiscover(runtime: ResolvedCliRuntime): Promise<CliCommandResult> {
  const [caveResult, covenResult] = await Promise.allSettled([
    runtime.cave.discoverEndpoint(runtime.discoveryOptions.cave),
    runtime.coven.discoverEndpoint(runtime.discoveryOptions.coven),
  ]);

  const data: Record<string, unknown> = {};
  let ok = true;

  if (caveResult.status === 'fulfilled') {
    data.cave = {
      status: 'ok',
      discovery: publicCaveDiscovery(caveResult.value),
    };
  } else {
    ok = false;
    data.cave = {
      status: 'error',
      error: normalizeCliError(caveResult.reason, {
        system: 'cave',
        operation: 'discover',
      }),
    };
  }

  if (covenResult.status === 'fulfilled') {
    data.coven = {
      status: 'ok',
      discovery: covenResult.value,
    };
  } else {
    ok = false;
    data.coven = {
      status: 'error',
      error: normalizeCliError(covenResult.reason, {
        system: 'coven',
        operation: 'discover',
      }),
    };
  }

  const output: CliOutput = {
    command: 'discover',
    data,
    ...(ok
      ? {}
      : {
          error: createCliError(
            'discovery_failed',
            'One or more runtime discovery probes failed.',
          ),
        }),
    human: renderDiscoverHuman({ command: 'discover', data, ok, version: runtime.version }),
    ok,
    version: runtime.version,
  };

  return {
    exitCode: ok ? 0 : 1,
    output,
  };
}
