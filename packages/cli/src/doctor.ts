import { createMemorySecretStore } from '@opencoven/sdk-core';

import type { CliCommandResult, ResolvedCliRuntime } from './main.js';
import { createCaveCredentialBinding } from './credentials.js';
import { createCliError, normalizeCliError, type CliCheck, type CliOutput } from './output.js';

function summarizeChecks(checks: readonly CliCheck[]) {
  return {
    healthy: checks.every((check) => check.status === 'ok'),
    ok: checks.filter((check) => check.status === 'ok').length,
    error: checks.filter((check) => check.status === 'error').length,
    skipped: checks.filter((check) => check.status === 'skipped').length,
  };
}

function renderDoctorHuman(checks: readonly CliCheck[]): readonly string[] {
  const summary = summarizeChecks(checks);
  const lines = [`OpenCoven doctor: ${summary.healthy ? 'healthy' : 'unhealthy'}`];

  for (const check of checks) {
    lines.push(`- ${check.id}: ${check.status} — ${check.summary}`);
    if (check.error?.action !== undefined) {
      lines.push(`  action: ${check.error.action}`);
    }
  }

  return lines;
}

export async function runDoctor(runtime: ResolvedCliRuntime): Promise<CliCommandResult> {
  const checks: CliCheck[] = [];

  let caveDiscovery: Awaited<ReturnType<ResolvedCliRuntime['cave']['discoverEndpoint']>> | undefined;
  try {
    caveDiscovery = await runtime.cave.discoverEndpoint(runtime.discoveryOptions.cave);
    checks.push({
      id: 'cave.discovery',
      status: 'ok',
      summary: 'Discovered the Cave client endpoint.',
      data: {
        endpoint: caveDiscovery.endpoint,
        freshness: {
          pid: caveDiscovery.freshness.pid,
          startedAt: caveDiscovery.freshness.startedAt,
        },
        record: caveDiscovery.record,
      },
    });
  } catch (error) {
    checks.push({
      id: 'cave.discovery',
      status: 'error',
      summary: 'Cave runtime discovery failed.',
      error: normalizeCliError(error, {
        system: 'cave',
        operation: 'discover',
      }),
    });
  }

  if (caveDiscovery === undefined) {
    checks.push({
      id: 'cave.health',
      status: 'skipped',
      summary: 'Not run because Cave discovery failed.',
    });
  } else {
    try {
      const client = await runtime.cave.createClient({
        credentials: createCaveCredentialBinding(
          createMemorySecretStore(),
          runtime.createSecretStoreReference,
        ),
        ...(runtime.discoveryOptions.cave === undefined
          ? {}
          : { discovery: runtime.discoveryOptions.cave }),
        fetch: runtime.fetch,
      });
      const health = await client.health();
      checks.push({
        id: 'cave.health',
        status: 'ok',
        summary: 'Cave health is compatible.',
        data: { ...health },
      });
    } catch (error) {
      checks.push({
        id: 'cave.health',
        status: 'error',
        summary: 'Cave health check failed.',
        error: normalizeCliError(error, {
          system: 'cave',
          operation: 'health',
        }),
      });
    }
  }

  try {
    await runtime.createSecretStore();
    checks.push({
      id: 'secure-store',
      status: 'ok',
      summary: 'Native secure credential storage is available.',
      data: {
        backend: 'native',
      },
    });
  } catch (error) {
    checks.push({
      id: 'secure-store',
      status: 'error',
      summary: 'Native secure credential storage is unavailable.',
      error: normalizeCliError(error, {
        system: 'secure-store',
        operation: 'store',
      }),
    });
  }

  let covenDiscovery: Awaited<ReturnType<ResolvedCliRuntime['coven']['discoverEndpoint']>> | undefined;
  try {
    covenDiscovery = await runtime.coven.discoverEndpoint(runtime.discoveryOptions.coven);
    checks.push({
      id: 'coven.discovery',
      status: 'ok',
      summary: 'Discovered the Coven daemon endpoint.',
      data: { ...covenDiscovery },
    });
  } catch (error) {
    checks.push({
      id: 'coven.discovery',
      status: 'error',
      summary: 'Coven runtime discovery failed.',
      error: normalizeCliError(error, {
        system: 'coven',
        operation: 'discover',
      }),
    });
  }

  if (covenDiscovery === undefined) {
    checks.push({
      id: 'coven.health',
      status: 'skipped',
      summary: 'Not run because Coven discovery failed.',
    });
  } else {
    try {
      const response = await runtime.coven.readHealth(covenDiscovery);
      checks.push({
        id: 'coven.health',
        status: 'ok',
        summary: 'Coven daemon health is compatible.',
        data: {
          covenVersion: response.covenVersion,
          capabilities: response.capabilities,
        },
      });
    } catch (error) {
      checks.push({
        id: 'coven.health',
        status: 'error',
        summary: 'Coven daemon health check failed.',
        error: normalizeCliError(error, {
          system: 'coven',
          operation: 'health',
        }),
      });
    }
  }

  const summary = summarizeChecks(checks);
  const output: CliOutput = {
    command: 'doctor',
    data: {
      checks,
      summary,
    },
    ...(summary.healthy
      ? {}
      : {
          error: createCliError('unhealthy', 'One or more diagnostics failed.'),
        }),
    human: renderDoctorHuman(checks),
    ok: summary.healthy,
    version: runtime.version,
  };

  return {
    exitCode: summary.healthy ? 0 : 1,
    output,
  };
}
