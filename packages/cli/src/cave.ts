import type {
  CaveCredentialMetadata,
  CaveCredentialStatus,
  CavePairingState,
  CavePairingStatus,
} from '@opencoven/cave-client';

import type { CaveCliPairingSession, CliCommandResult, ResolvedCliRuntime } from './main.js';
import {
  createCaveCredentialBinding,
  DEFAULT_CAVE_PAIRING_REQUEST,
} from './credentials.js';
import { createCliError, normalizeCliError, type CliOutput } from './output.js';

const PAIR_POLL_INTERVAL_MS = 1_000;
const PAIR_MAX_WAIT_MS = 30_000;
const PAIR_EXPIRY_GUARD_MS = 250;

function pairDeadline(now: number, expiresAt: number): number {
  return Math.min(now + PAIR_MAX_WAIT_MS, expiresAt - PAIR_EXPIRY_GUARD_MS);
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

async function createCaveClient(runtime: ResolvedCliRuntime) {
  const store = await runtime.createSecretStore();

  return await runtime.cave.createClient({
    credentials: createCaveCredentialBinding(store, runtime.createSecretStoreReference),
    ...(runtime.discoveryOptions.cave === undefined
      ? {}
      : { discovery: runtime.discoveryOptions.cave }),
    fetch: runtime.fetch,
  });
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
  let client;
  try {
    client = await createCaveClient(runtime);
  } catch (error) {
    const normalized = normalizeCliError(error, {
      system: 'secure-store',
      operation: 'store',
    });
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
    session = await client.createPairing({
      ...DEFAULT_CAVE_PAIRING_REQUEST,
      scopes: [...DEFAULT_CAVE_PAIRING_REQUEST.scopes],
    });
  } catch (error) {
    const normalized = normalizeCliError(error, {
      system: 'cave',
      operation: 'pair',
    });
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
  const deadline = pairDeadline(startedAt, expiresAt);

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

  while (runtime.now() < deadline) {
    let status: CavePairingStatus;
    attempts += 1;

    try {
      status = await session.poll();
    } catch (error) {
      const normalized = normalizeCliError(error, {
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

    if (status.status === 'approved') {
      try {
        const credential: CaveCredentialMetadata = await session.exchange();
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
        const normalized = normalizeCliError(error, {
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

    const remaining = deadline - runtime.now();
    if (remaining <= 0) {
      break;
    }

    await runtime.sleep(Math.min(PAIR_POLL_INTERVAL_MS, remaining));
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
  let client;
  try {
    client = await createCaveClient(runtime);
  } catch (error) {
    const normalized = normalizeCliError(error, {
      system: 'secure-store',
      operation: 'store',
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

  try {
    const status: CaveCredentialStatus = await client.credentialStatus();

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
  let client;
  try {
    client = await createCaveClient(runtime);
  } catch (error) {
    const normalized = normalizeCliError(error, {
      system: 'secure-store',
      operation: 'store',
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

  try {
    const deleted = await client.forgetCredential();
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
