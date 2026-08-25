import {
  createMemorySecretStore,
  createOpenCovenDiagnosticReport,
  type OpenCovenDiagnosticCheckInput,
  type OpenCovenDiagnosticReport,
} from '@opencoven/sdk-core';

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
import {
  createCliError,
  normalizeCliError,
  type CliError,
  type CliOutput,
} from './output.js';

const CHECK_LABELS = {
  'cave.discovery': 'Cave discovery',
  'cave.health': 'Cave health',
  'secure-store': 'Native secure store',
  'coven.discovery': 'Coven discovery',
  'coven.health': 'Coven health',
} as const;
const DIAGNOSTIC_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function diagnosticTimestamp(now: () => number): string {
  return new Date(now()).toISOString();
}

function ownData(value: unknown, key: PropertyKey): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined &&
      Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function diagnosticErrorInput(
  error: unknown,
  normalized: CliError,
): Record<string, unknown> {
  const nested = ownData(error, 'normalized');
  const candidate =
    ownData(error, 'requestId') ?? ownData(nested, 'requestId');
  const diagnosticId =
    typeof candidate === 'string' && DIAGNOSTIC_ID_RE.test(candidate)
      ? candidate
      : undefined;
  return {
    code: normalized.code,
    retryable: normalized.retryable ?? false,
    ...(diagnosticId === undefined ? {} : { diagnosticId }),
  };
}

function renderDoctorHuman(
  report: OpenCovenDiagnosticReport,
): readonly string[] {
  const lines = [
    `OpenCoven doctor: ${report.summary.healthy ? 'healthy' : 'unhealthy'}`,
  ];

  for (const check of report.checks) {
    const label = CHECK_LABELS[check.id];
    if (check.status === 'error') {
      lines.push(
        `- ${check.id}: error — ${label} failed (${check.error?.code ?? 'unknown'}, ${
          check.error?.retryable === true
            ? 'retryable'
            : 'not retryable'
        })`,
      );
      if (check.error?.diagnosticId !== undefined) {
        lines.push(`  diagnostic: ${check.error.diagnosticId}`);
      }
    } else if (check.status === 'skipped') {
      lines.push(
        `- ${check.id}: skipped — ${
          check.skipReason === 'deadline-expired'
            ? 'Doctor deadline expired.'
            : `${label} dependency failed.`
        }`,
      );
    } else {
      lines.push(`- ${check.id}: ok — ${label} succeeded.`);
    }
  }

  return lines;
}

function doctorResult(
  runtime: ResolvedCliRuntime,
  generatedAt: string,
  checks: readonly OpenCovenDiagnosticCheckInput[],
): CliCommandResult {
  const report = createOpenCovenDiagnosticReport({
    generatedAt,
    packageVersion: runtime.version,
    runtime: {
      name: 'node',
      version: process.version,
      platform: runtime.platform,
      architecture: process.arch,
    },
    checks,
  });
  const output: CliOutput = {
    command: 'doctor',
    data: { ...report },
    ...(report.summary.healthy
      ? {}
      : {
          error: createCliError('unhealthy', 'One or more diagnostics failed.'),
        }),
    human: renderDoctorHuman(report),
    ok: report.summary.healthy,
    version: runtime.version,
  };

  return {
    exitCode: report.summary.healthy ? 0 : 1,
    output,
  };
}

function doctorTimedOut(
  checks: OpenCovenDiagnosticCheckInput[],
  ...remainingIds: OpenCovenDiagnosticCheckInput['id'][]
): void {
  for (const id of remainingIds) {
    checks.push({
      id,
      status: 'skipped',
      skipReason: 'deadline-expired',
    });
  }
}

export async function runDoctor(runtime: ResolvedCliRuntime): Promise<CliCommandResult> {
  const generatedAt = diagnosticTimestamp(runtime.now);
  const checks: OpenCovenDiagnosticCheckInput[] = [];
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
      error: diagnosticErrorInput(
        cavePlatformSecurityError,
        normalized,
      ),
    });
    checks.push({
      id: 'cave.health',
      status: 'skipped',
      skipReason: 'dependency-failed',
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
        discovery: caveDiscovery,
      });
    } catch (error) {
      const normalized = normalizeCliError(error, {
        system: 'cave',
        operation: 'discover',
      });
      checks.push({
        id: 'cave.discovery',
        status: 'error',
        error: diagnosticErrorInput(error, normalized),
      });
      if (normalized.code === 'timeout') {
        doctorTimedOut(
          checks,
          'cave.health',
          'secure-store',
          'coven.discovery',
          'coven.health',
        );
        return doctorResult(runtime, generatedAt, checks);
      }
    }
    if (caveDiscovery === undefined) {
      checks.push({
        id: 'cave.health',
        status: 'skipped',
        skipReason: 'dependency-failed',
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
          observedAt: diagnosticTimestamp(runtime.now),
          health,
        });
      } catch (error) {
        const normalized = normalizeCliError(error, {
          system: 'cave',
          operation: 'health',
        });
        checks.push({
          id: 'cave.health',
          status: 'error',
          error: diagnosticErrorInput(error, normalized),
        });
        if (normalized.code === 'timeout') {
          doctorTimedOut(
            checks,
            'secure-store',
            'coven.discovery',
            'coven.health',
          );
          return doctorResult(runtime, generatedAt, checks);
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
      observedAt: diagnosticTimestamp(runtime.now),
    });
  } catch (error) {
    const normalized = normalizeCliError(error, {
      system: 'secure-store',
      operation: 'probe',
    });
    checks.push({
      id: 'secure-store',
      status: 'error',
      error: diagnosticErrorInput(error, normalized),
    });
    if (normalized.code === 'timeout') {
      doctorTimedOut(checks, 'coven.discovery', 'coven.health');
      return doctorResult(runtime, generatedAt, checks);
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
      discovery: covenDiscovery,
    });
  } catch (error) {
    const normalized = normalizeCliError(error, {
      system: 'coven',
      operation: 'discover',
    });
    checks.push({
      id: 'coven.discovery',
      status: 'error',
      error: diagnosticErrorInput(error, normalized),
    });
    if (normalized.code === 'timeout') {
      doctorTimedOut(checks, 'coven.health');
      return doctorResult(runtime, generatedAt, checks);
    }
  }

  if (covenDiscovery === undefined) {
    checks.push({
      id: 'coven.health',
      status: 'skipped',
      skipReason: 'dependency-failed',
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
        observedAt: diagnosticTimestamp(runtime.now),
        health: response,
      });
    } catch (error) {
      const normalized = normalizeCliError(error, {
        system: 'coven',
        operation: 'health',
      });
      checks.push({
        id: 'coven.health',
        status: 'error',
        error: diagnosticErrorInput(error, normalized),
      });
    }
  }

  return doctorResult(runtime, generatedAt, checks);
}
