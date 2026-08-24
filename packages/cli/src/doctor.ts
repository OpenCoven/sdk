import { createMemorySecretStore } from '@opencoven/sdk-core';

import {
  missingCliCavePlatformSecurity,
} from './cave-platform-security.js';
import {
  createPinnedCliCaveDiscoverEndpoint,
} from './cave-discovery.js';
import {
  createCliDeadline,
  runWithinCliDeadline,
} from './command-timing.js';
import type { CliCommandResult, ResolvedCliRuntime } from './main.js';
import { createCaveCredentialBinding } from './credentials.js';
import { probeNativeSecretStore } from './native-secret-store.js';
import { createCliError, normalizeCliError, type CliCheck, type CliOutput } from './output.js';

const DOCTOR_TIMEOUT_SKIP_SUMMARY = 'Not run because the doctor deadline expired.';

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

function doctorResult(
  runtime: ResolvedCliRuntime,
  checks: readonly CliCheck[],
): CliCommandResult {
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

function doctorTimedOut(checks: CliCheck[], ...remainingIds: string[]): void {
  for (const id of remainingIds) {
    checks.push({
      id,
      status: 'skipped',
      summary: DOCTOR_TIMEOUT_SKIP_SUMMARY,
    });
  }
}

export async function runDoctor(runtime: ResolvedCliRuntime): Promise<CliCommandResult> {
  const checks: CliCheck[] = [];
  const deadline = createCliDeadline(runtime.now, runtime.timing.doctorTimeoutMs);

  let caveDiscovery: Awaited<ReturnType<ResolvedCliRuntime['cave']['discoverEndpoint']>> | undefined;
  const cavePlatformSecurityError = missingCliCavePlatformSecurity(runtime);
  if (cavePlatformSecurityError !== undefined) {
    const normalized = normalizeCliError(cavePlatformSecurityError, {
      system: 'cave',
      operation: 'discover',
    });
    checks.push({
      id: 'cave.discovery',
      status: 'error',
      summary: 'Cave runtime discovery failed.',
      error: normalized,
    });
    checks.push({
      id: 'cave.health',
      status: 'skipped',
      summary: 'Not run because Cave discovery failed.',
    });
  } else {
    try {
      caveDiscovery = await runWithinCliDeadline(
        runtime.now,
        deadline,
        'doctor',
        async (timeoutMs) =>
          await runtime.cave.discoverEndpoint({
            ...runtime.discoveryOptions.cave,
            timeoutMs,
          }),
      );
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
      const normalized = normalizeCliError(error, {
        system: 'cave',
        operation: 'discover',
      });
      checks.push({
        id: 'cave.discovery',
        status: 'error',
        summary: 'Cave runtime discovery failed.',
        error: normalized,
      });
      if (normalized.code === 'timeout') {
        doctorTimedOut(
          checks,
          'cave.health',
          'secure-store',
          'coven.discovery',
          'coven.health',
        );
        return doctorResult(runtime, checks);
      }
    }
    if (caveDiscovery === undefined) {
      checks.push({
        id: 'cave.health',
        status: 'skipped',
        summary: 'Not run because Cave discovery failed.',
      });
    } else {
      try {
        const client = await runWithinCliDeadline(
          runtime.now,
          deadline,
          'doctor',
          async () =>
            await runtime.cave.createClient({
              credentials: createCaveCredentialBinding(
                createMemorySecretStore(),
                runtime.createSecretStoreReference,
              ),
              discoverEndpoint: createPinnedCliCaveDiscoverEndpoint(runtime, caveDiscovery),
              ...(runtime.discoveryOptions.cave === undefined
                ? {}
                : { discovery: runtime.discoveryOptions.cave }),
              fetch: runtime.fetch,
            }),
        );
        const health = await runWithinCliDeadline(
          runtime.now,
          deadline,
          'doctor',
          async (timeoutMs) => await client.health({ timeoutMs }),
        );
        checks.push({
          id: 'cave.health',
          status: 'ok',
          summary: 'Cave health is compatible.',
          data: { ...health },
        });
      } catch (error) {
        const normalized = normalizeCliError(error, {
          system: 'cave',
          operation: 'health',
        });
        checks.push({
          id: 'cave.health',
          status: 'error',
          summary: 'Cave health check failed.',
          error: normalized,
        });
        if (normalized.code === 'timeout') {
          doctorTimedOut(
            checks,
            'secure-store',
            'coven.discovery',
            'coven.health',
          );
          return doctorResult(runtime, checks);
        }
      }
    }
  }

  try {
    const store = await runWithinCliDeadline(
      runtime.now,
      deadline,
      'doctor',
      async () => await runtime.createSecretStore(),
    );
    await runWithinCliDeadline(
      runtime.now,
      deadline,
      'doctor',
      async () => {
        await probeNativeSecretStore(store);
        return undefined;
      },
    );
    checks.push({
      id: 'secure-store',
      status: 'ok',
      summary: 'Native secure credential storage is available.',
      data: {
        backend: 'native',
      },
    });
  } catch (error) {
    const normalized = normalizeCliError(error, {
      system: 'secure-store',
      operation: 'probe',
    });
    checks.push({
      id: 'secure-store',
      status: 'error',
      summary: 'Native secure credential storage is unavailable.',
      error: normalized,
    });
    if (normalized.code === 'timeout') {
      doctorTimedOut(checks, 'coven.discovery', 'coven.health');
      return doctorResult(runtime, checks);
    }
  }

  let covenDiscovery: Awaited<ReturnType<ResolvedCliRuntime['coven']['discoverEndpoint']>> | undefined;
  try {
    covenDiscovery = await runWithinCliDeadline(
      runtime.now,
      deadline,
      'doctor',
      async (timeoutMs) =>
        await runtime.coven.discoverEndpoint({
          ...runtime.discoveryOptions.coven,
          timeoutMs,
        }),
    );
    checks.push({
      id: 'coven.discovery',
      status: 'ok',
      summary: 'Discovered the Coven daemon endpoint.',
      data: { ...covenDiscovery },
    });
  } catch (error) {
    const normalized = normalizeCliError(error, {
      system: 'coven',
      operation: 'discover',
    });
    checks.push({
      id: 'coven.discovery',
      status: 'error',
      summary: 'Coven runtime discovery failed.',
      error: normalized,
    });
    if (normalized.code === 'timeout') {
      doctorTimedOut(checks, 'coven.health');
      return doctorResult(runtime, checks);
    }
  }

  if (covenDiscovery === undefined) {
    checks.push({
      id: 'coven.health',
      status: 'skipped',
      summary: 'Not run because Coven discovery failed.',
    });
  } else {
    try {
      const response = await runWithinCliDeadline(
        runtime.now,
        deadline,
        'doctor',
        async (timeoutMs) =>
          await runtime.coven.readHealth(covenDiscovery, { timeoutMs }),
      );
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

  return doctorResult(runtime, checks);
}
