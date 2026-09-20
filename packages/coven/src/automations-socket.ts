import { runOperation, type OperationContext } from '@opencoven/sdk-core';

import type { CovenAutomationsTransport } from './automations.js';
import { definitionReadBytes } from './automations-definitions.js';
import { AUTOMATION_EVENTS_MAX_BYTES } from './automations-events.js';
import { CovenClientError, normalizeCovenError } from './client-errors.js';
import {
  requestCovenPolicyOverSocket,
  type CovenSocketAccess,
} from './transport-unix.js';

export function createCovenAutomationsSocketTransport(
  access: CovenSocketAccess,
): CovenAutomationsTransport {
  async function request(wire: Buffer, context: OperationContext, operation: string, maxBodyBytes = 16_384) {
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
        return requestCovenPolicyOverSocket(access.path, hooks, bounded, wire, maxBodyBytes);
      },
    );
  }
  return {
    capabilities(context) {
      return request(Buffer.from(
        'GET /api/v1/capabilities HTTP/1.1\r\n' +
        'Host: coven\r\nAccept: application/json\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      ), context, 'automations.capabilities');
    },
    async readDefinitions(input, context) {
      const body = definitionReadBytes(input);
      // Inspect only the validated, serialized request, never caller accessors.
      const { action } = JSON.parse(body.toString()) as { action: string };
      return request(Buffer.concat([
        Buffer.from(
          'POST /api/v1/actions HTTP/1.1\r\nHost: coven\r\nAccept: application/json\r\n' +
          'Content-Type: application/json\r\nConnection: close\r\n' +
          `Content-Length: ${body.byteLength}\r\n\r\n`,
        ),
        body,
      ]), context, 'automations.read', action === 'coven.automations.events.subscribe.v1' ? AUTOMATION_EVENTS_MAX_BYTES : 16_384);
    },
  };
}
