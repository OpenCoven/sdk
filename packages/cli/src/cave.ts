import type {
  CaveCredentialMetadata,
  CaveCredentialStatus,
  CavePairingState,
  CavePairingStatus,
} from '@opencoven/cave-client';

import type { CaveCliPairingSession, CliCommandResult, ResolvedCliRuntime } from './main.js';
import {
  assertCliCavePlatformSecurity,
} from './cave-platform-security.js';
import {
  createCliDeadline,
  remainingCliTime,
  runWithinCliDeadline,
} from './command-timing.js';
import {
  createPinnedCliCaveDiscoverEndpoint,
} from './cave-discovery.js';
import {
  createCaveCredentialBinding,
  DEFAULT_CAVE_PAIRING_REQUEST,
} from './credentials.js';
import { createCliError, normalizeCliError, type CliOutput } from './output.js';

const PAIR_EXPIRY_GUARD_MS = 250;

function createCaveClientErrorContext(error: unknown) {
  if (typeof error === 'object' && error !== null) {
    try {
      if (Reflect.get(error, 'code') === 'platform_security_unavailable') {
        return {
          system: 'cave' as const,
          operation: 'discover',
        };
      }
    } catch {
      // Fall back to secure-store context below.
    }
  }

  return {
    system: 'secure-store' as const,
    operation: 'store',
  };
}

function pairDeadline(deadline: number, expiresAt: number): number {
  return Math.min(deadline, expiresAt - PAIR_EXPIRY_GUARD_MS);
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

function pairFailureFromStatus(status: CavePairingState) {
  return createCliError(
    `pairing_${status}`,
    status === 'denied'
      ? 'Cave pairing request was denied.'
      : 'Cave pairing request expired before approval.',
    {
      action: 'Start a new pairing request with `opencoven cave pair`.',
    },
  );
}

function pairTimeoutError(cause?: unknown): Error {
  return Object.assign(
    new Error('The Cave operation timed out.', cause === undefined ? undefined : { cause }),
    {
      code: 'timeout',
      retryable: true,
    },
  );
}

function throwIfPairBudgetExhausted(now: number, deadline: number): void {
  if (now >= deadline) {
    throw pairTimeoutError();
  }
}

function pairBudgetBoundaryError(
  error: unknown,
  now: number,
  deadline: number,
): unknown {
  return now >= deadline ? pairTimeoutError(error) : error;
}

function renderPairHuman(output: CliOutput): readonly string[] {
  const data = output.data;
  const requestId = typeof data?.requestId === 'string' ? data.requestId : 'unknown';
  const expiresAt = typeof data?.expiresAt === 'number' ? iso(data.expiresAt) : undefined;

  if (output.ok) {
    return [
      'Cave pairing approved.',
      `Request: ${requestId}`,
      typeof data?.attempts === 'number' ? `Poll attempts: ${String(data.attempts)}` : 'Poll attempts: 0',
      '',
    ];
  }

  const lines = [output.error?.message ?? 'Cave pairing failed.', `Request: ${requestId}`];
  if (expiresAt !== undefined) {
    lines.push(`Expires: ${expiresAt}`);
  }
  if (output.error?.action !== undefined) {
    lines.push(`Action: ${output.error.action}`);
  }
  return lines;
}

function renderStatusHuman(output: CliOutput): readonly string[] {
  const data = output.data;
  const status = typeof data?.status === 'string' ? data.status : 'unknown';

  if (output.ok) {
    const lines = [`Cave credential status: ${status}`];
    if (typeof data?.access === 'string') {
      lines.push(`Access: ${data.access}`);
    }
    return lines;
  }

  const lines = [`Cave credential status: ${status}`, output.error?.message ?? 'Credential status failed.'];
  if (output.error?.action !== undefined) {
    lines.push(`Action: ${output.error.action}`);
  }
  return lines;
}

function renderForgetHuman(output: CliOutput): readonly string[] {
  if (output.ok) {
    const deleted = (output.data)?.deleted === true;
    return [deleted ? 'Cave credential removed.' : 'No stored Cave credential was present.'];
  }

  const lines = [output.error?.message ?? 'Cave credential removal failed.'];
  if (output.error?.action !== undefined) {
    lines.push(`Action: ${output.error.action}`);
  }
  return lines;
}

async function createCaveClient(
  runtime: ResolvedCliRuntime,
  deadline: number,
  operation: 'cave pair' | 'cave status' | 'cave forget',
) {
  assertCliCavePlatformSecurity(runtime);
  const store = await runWithinCliDeadline(
    runtime.now,
    deadline,
    operation,
    async () => await runtime.createSecretStore(),
  );

  return await runWithinCliDeadline(
    runtime.now,
    deadline,
    operation,
    async () =>
      await runtime.cave.createClient({
        credentials: createCaveCredentialBinding(store, runtime.createSecretStoreReference),
        discoverEndpoint: createPinnedCliCaveDiscoverEndpoint(runtime),
        ...(runtime.discoveryOptions.cave === undefined
          ? {}
          : { discovery: runtime.discoveryOptions.cave }),
        fetch: runtime.fetch,
      }),
  );
}

function pairingData(
  requestId: string,
  expiresAt: number,
  attempts: number,
  status?: CavePairingState,
): Record<string, unknown> {
  return {
    attempts,
    expiresAt,
    requestId,
    ...(status === undefined ? {} : { status }),
  };
}

async function runPair(runtime: ResolvedCliRuntime): Promise<CliCommandResult> {
  const commandDeadline = createCliDeadline(runtime.now, runtime.timing.cavePairTimeoutMs);
  let client;
  try {
    client = await createCaveClient(runtime, commandDeadline, 'cave pair');
  } catch (error) {
    const normalized = normalizeCliError(error, createCaveClientErrorContext(error));
    const output: CliOutput = {
      command: 'cave pair',
      error: normalized,
      human: renderPairHuman({
        command: 'cave pair',
        error: normalized,
        ok: false,
        version: runtime.version,
      }),
      ok: false,
      version: runtime.version,
    };
    return { exitCode: 1, output };
  }

  let session: CaveCliPairingSession;
  try {
    session = await runWithinCliDeadline(
      runtime.now,
      commandDeadline,
      'cave pair',
      async (timeoutMs) =>
        await client.createPairing(
          {
            ...DEFAULT_CAVE_PAIRING_REQUEST,
            scopes: [...DEFAULT_CAVE_PAIRING_REQUEST.scopes],
          },
          { timeoutMs },
        ),
    );
  } catch (error) {
    const normalized = normalizeCliError(
      pairBudgetBoundaryError(error, runtime.now(), commandDeadline),
      {
        system: 'cave',
        operation: 'pair',
      },
    );
    const output: CliOutput = {
      command: 'cave pair',
      error: normalized,
      human: renderPairHuman({
        command: 'cave pair',
        error: normalized,
        ok: false,
        version: runtime.version,
      }),
      ok: false,
      version: runtime.version,
    };
    return { exitCode: 1, output };
  }

  const requestId = session.requestId;
  const expiresAt = session.expiresAt;
  const startedAt = runtime.now();
  let attempts = 0;
  const deadline = pairDeadline(commandDeadline, expiresAt);

  if (startedAt >= expiresAt) {
    const error = pairFailureFromStatus('expired');
    const data = pairingData(requestId, expiresAt, attempts, 'expired');
    const output: CliOutput = {
      command: 'cave pair',
      data,
      error,
      human: renderPairHuman({
        command: 'cave pair',
        data,
        error,
        ok: false,
        version: runtime.version,
      }),
      ok: false,
      version: runtime.version,
    };
    return { exitCode: 1, output };
  }

  if (startedAt >= deadline) {
    const error = normalizeCliError(pairTimeoutError(), {
      system: 'cave',
      operation: 'pair',
    });
    const data = pairingData(requestId, expiresAt, attempts);
    const output: CliOutput = {
      command: 'cave pair',
      data,
      error,
      human: renderPairHuman({
        command: 'cave pair',
        data,
        error,
        ok: false,
        version: runtime.version,
      }),
      ok: false,
      version: runtime.version,
    };
    return { exitCode: 1, output };
  }

  while (runtime.now() < deadline) {
    let status: CavePairingStatus;
    attempts += 1;

    try {
      status = await runWithinCliDeadline(
        runtime.now,
        deadline,
        'cave pair',
        async (timeoutMs) => await session.poll({ timeoutMs }),
      );
      throwIfPairBudgetExhausted(runtime.now(), deadline);
    } catch (error) {
      const normalized = normalizeCliError(
        pairBudgetBoundaryError(error, runtime.now(), deadline),
        {
          system: 'cave',
          operation: 'pair',
        },
      );
      const data = pairingData(requestId, expiresAt, attempts);
      const output: CliOutput = {
        command: 'cave pair',
        data,
        error: normalized,
        human: renderPairHuman({
          command: 'cave pair',
          data,
          error: normalized,
          ok: false,
          version: runtime.version,
        }),
        ok: false,
        version: runtime.version,
      };
      return { exitCode: 1, output };
    }

    if (status.status === 'approved') {
      try {
        const credential: CaveCredentialMetadata = await runWithinCliDeadline(
          runtime.now,
          deadline,
          'cave pair',
          async (timeoutMs) => await session.exchange({ timeoutMs }),
        );
        throwIfPairBudgetExhausted(runtime.now(), deadline);
        const data = {
          ...pairingData(requestId, expiresAt, attempts, 'approved'),
          credential,
        };
        const output: CliOutput = {
          command: 'cave pair',
          data,
          human: renderPairHuman({
            command: 'cave pair',
            data,
            ok: true,
            version: runtime.version,
          }),
          ok: true,
          version: runtime.version,
        };
        return { exitCode: 0, output };
      } catch (error) {
        const normalized = normalizeCliError(
          pairBudgetBoundaryError(error, runtime.now(), deadline),
          {
            system: 'cave',
            operation: 'pair',
          },
        );
        const data = pairingData(requestId, expiresAt, attempts);
        const output: CliOutput = {
          command: 'cave pair',
          data,
          error: normalized,
          human: renderPairHuman({
            command: 'cave pair',
            data,
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

    if (status.status === 'denied' || status.status === 'expired') {
      const error = pairFailureFromStatus(status.status);
      const data = pairingData(requestId, expiresAt, attempts, status.status);
      const output: CliOutput = {
        command: 'cave pair',
        data,
        error,
        human: renderPairHuman({
          command: 'cave pair',
          data,
          error,
          ok: false,
          version: runtime.version,
        }),
        ok: false,
        version: runtime.version,
      };
      return { exitCode: 1, output };
    }

    const remaining = remainingCliTime(runtime.now, deadline);
    if (remaining <= 0) {
      break;
    }

    try {
      await runWithinCliDeadline(
        runtime.now,
        deadline,
        'cave pair',
        async (timeoutMs) => {
          await runtime.sleep(Math.min(runtime.timing.cavePairPollIntervalMs, timeoutMs));
          return undefined;
        },
      );
    } catch (error) {
      const normalized = normalizeCliError(error, {
        system: 'cave',
        operation: 'pair',
      });
      const data = pairingData(requestId, expiresAt, attempts, 'pending');
      const output: CliOutput = {
        command: 'cave pair',
        data,
        error: normalized,
        human: renderPairHuman({
          command: 'cave pair',
          data,
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

  if (runtime.now() >= commandDeadline) {
    const normalized = normalizeCliError(pairTimeoutError(), {
      system: 'cave',
      operation: 'pair',
    });
    const data = pairingData(requestId, expiresAt, attempts);
    const output: CliOutput = {
      command: 'cave pair',
      data,
      error: normalized,
      human: renderPairHuman({
        command: 'cave pair',
        data,
        error: normalized,
        ok: false,
        version: runtime.version,
      }),
      ok: false,
      version: runtime.version,
    };
    return { exitCode: 1, output };
  }

  const error = createCliError(
    'pairing_pending',
    'Cave pairing is still pending approval.',
    {
      action:
        'Approve the pairing request in Cave and rerun `opencoven cave pair` before the request expires.',
    },
  );
  const data = pairingData(requestId, expiresAt, attempts, 'pending');
  const output: CliOutput = {
    command: 'cave pair',
    data,
    error,
    human: renderPairHuman({
      command: 'cave pair',
      data,
      error,
      ok: false,
      version: runtime.version,
    }),
    ok: false,
    version: runtime.version,
  };
  return { exitCode: 1, output };
}

async function runStatus(runtime: ResolvedCliRuntime): Promise<CliCommandResult> {
  const deadline = createCliDeadline(runtime.now, runtime.timing.caveStatusTimeoutMs);
  let client;
  try {
    client = await createCaveClient(runtime, deadline, 'cave status');
  } catch (error) {
    const normalized = normalizeCliError(error, createCaveClientErrorContext(error));
    const output: CliOutput = {
      command: 'cave status',
      error: normalized,
      human: renderStatusHuman({
        command: 'cave status',
        error: normalized,
        ok: false,
        version: runtime.version,
      }),
      ok: false,
      version: runtime.version,
    };
    return { exitCode: 1, output };
  }

  try {
    const status: CaveCredentialStatus = await runWithinCliDeadline(
      runtime.now,
      deadline,
      'cave status',
      async (timeoutMs) => await client.credentialStatus({ timeoutMs }),
    );

    if (status.status === 'missing') {
      const error = createCliError(
        'missing_credential',
        'No Cave credential is stored.',
        {
          action: 'Run `opencoven cave pair` to create and store a credential.',
        },
      );
      const data = { status: 'missing' };
      const output: CliOutput = {
        command: 'cave status',
        data,
        error,
        human: renderStatusHuman({
          command: 'cave status',
          data,
          error,
          ok: false,
          version: runtime.version,
        }),
        ok: false,
        version: runtime.version,
      };
      return { exitCode: 1, output };
    }

    if (status.status === 'revoked') {
      const error = createCliError(
        'revoked_credential',
        'The stored Cave credential was rejected by Cave.',
        {
          action: 'Run `opencoven cave forget` and pair again.',
        },
      );
      const data = {
        status: 'revoked',
        health: status.health,
      };
      const output: CliOutput = {
        command: 'cave status',
        data,
        error,
        human: renderStatusHuman({
          command: 'cave status',
          data,
          error,
          ok: false,
          version: runtime.version,
        }),
        ok: false,
        version: runtime.version,
      };
      return { exitCode: 1, output };
    }

    const data = {
      status: 'valid',
      access: status.access,
      health: status.health,
    };
    const output: CliOutput = {
      command: 'cave status',
      data,
      human: renderStatusHuman({
        command: 'cave status',
        data,
        ok: true,
        version: runtime.version,
      }),
      ok: true,
      version: runtime.version,
    };
    return { exitCode: 0, output };
  } catch (error) {
    const normalized = normalizeCliError(error, {
      system: 'cave',
      operation: 'status',
    });
    const output: CliOutput = {
      command: 'cave status',
      error: normalized,
      human: renderStatusHuman({
        command: 'cave status',
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

async function runForget(runtime: ResolvedCliRuntime): Promise<CliCommandResult> {
  const deadline = createCliDeadline(runtime.now, runtime.timing.caveForgetTimeoutMs);
  let client;
  try {
    client = await createCaveClient(runtime, deadline, 'cave forget');
  } catch (error) {
    const normalized = normalizeCliError(error, createCaveClientErrorContext(error));
    const output: CliOutput = {
      command: 'cave forget',
      error: normalized,
      human: renderForgetHuman({
        command: 'cave forget',
        error: normalized,
        ok: false,
        version: runtime.version,
      }),
      ok: false,
      version: runtime.version,
    };
    return { exitCode: 1, output };
  }

  try {
    const deleted = await runWithinCliDeadline(
      runtime.now,
      deadline,
      'cave forget',
      async (timeoutMs) => await client.forgetCredential({ timeoutMs }),
    );
    const output: CliOutput = {
      command: 'cave forget',
      data: { deleted },
      human: renderForgetHuman({
        command: 'cave forget',
        data: { deleted },
        ok: true,
        version: runtime.version,
      }),
      ok: true,
      version: runtime.version,
    };
    return { exitCode: 0, output };
  } catch (error) {
    const normalized = normalizeCliError(error, {
      system: 'cave',
      operation: 'forget',
    });
    const output: CliOutput = {
      command: 'cave forget',
      error: normalized,
      human: renderForgetHuman({
        command: 'cave forget',
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

export async function runCaveCommand(
  action: 'pair' | 'status' | 'forget',
  runtime: ResolvedCliRuntime,
): Promise<CliCommandResult> {
  switch (action) {
    case 'pair':
      return await runPair(runtime);
    case 'status':
      return await runStatus(runtime);
    case 'forget':
      return await runForget(runtime);
  }
}
