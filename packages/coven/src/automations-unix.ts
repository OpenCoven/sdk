import { runOperation } from '@opencoven/sdk-core';

import type { CovenAutomationsTransport } from './automations.js';
import { CovenClientError, normalizeCovenError } from './client.js';
import type { CovenDiscoveredEndpoint } from './discovery.js';
import {
  createCovenUnixSocketAccess,
  requestCovenPolicyOverSocket,
  type CovenUnixTransportDependencies,
  type CovenUnixTransportSecurityProvider,
} from './transport-unix.js';

export interface CovenAutomationsUnixTransportOptions {
  readonly security: CovenUnixTransportSecurityProvider;
  readonly dependencies?: CovenUnixTransportDependencies;
}

/** Uses the same endpoint and connected-peer checks as the Unix health transport. */
export function createCovenAutomationsUnixTransport(
  discovered: CovenDiscoveredEndpoint,
  options: CovenAutomationsUnixTransportOptions,
): CovenAutomationsTransport {
  if (process.platform === 'win32') {
    throw new CovenClientError(normalizeCovenError({ code: 'unsupported_platform' }, 'automations.capabilities'));
  }
  const access = createCovenUnixSocketAccess(discovered, options);
  return {
    async capabilities(context) {
      const operation = 'automations.capabilities';
      if (context === undefined || (context.deadline !== undefined && !Number.isFinite(context.deadline))) {
        throw new CovenClientError(normalizeCovenError({ code: 'invalid_options' }, operation));
      }
      const startedAt = performance.now();
      const deadline = Math.min(context.deadline ?? startedAt + 5_000, startedAt + 300_000);
      if (deadline <= startedAt) {
        throw new CovenClientError(normalizeCovenError({ code: 'timeout' }, operation));
      }
      return runOperation(
        { system: 'coven', operation },
        { signal: context.signal, timeoutMs: Math.ceil(deadline - startedAt) },
        async (scope) => {
          const bounded = { signal: scope.signal, deadline };
          const hooks = await access.prepare(bounded);
          return requestCovenPolicyOverSocket(
            access.path, hooks, bounded,
            Buffer.from(
              'GET /api/v1/capabilities HTTP/1.1\r\n' +
              'Host: coven\r\nAccept: application/json\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
            ),
          );
        },
      );
    },
  };
}
