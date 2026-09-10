import {
  isOperationAbortedError,
  isOperationTimeoutError,
  OperationConfigurationError,
  runOperation,
  type OperationContext,
} from '@opencoven/sdk-core';

import { isCovenIpcError, type CovenDiscoveredEndpoint } from './discovery.js';
import {
  CovenSessionPolicyError,
  type CovenSessionPolicyErrorCode,
  type CovenSessionPolicyTransport,
  type CovenSessionPolicyTransportRequest,
} from './session-policy.js';
import {
  createCovenUnixSocketAccess,
  requestCovenPolicyOverSocket,
  type CovenUnixTransportDependencies,
  type CovenUnixTransportSecurityProvider,
} from './transport-unix.js';

export interface CovenSessionPolicyUnixTransportOptions {
  readonly security: CovenUnixTransportSecurityProvider;
  readonly dependencies?: CovenUnixTransportDependencies;
}

function requestBytes(request: CovenSessionPolicyTransportRequest): Buffer {
  const invalid = (): never => {
    throw new CovenSessionPolicyError('invalid_request', 'sessionPolicy.launchRestricted', 'not_attempted');
  };
  let descriptors: PropertyDescriptorMap;
  try {
    if (!Object.isFrozen(request)) return invalid();
    descriptors = Object.getOwnPropertyDescriptors(request);
  } catch {
    return invalid();
  }
  const own = (key: string): unknown => {
    const descriptor = descriptors[key];
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  };
  const method = own('method');
  const path = own('path');
  const keys = Reflect.ownKeys(descriptors);
  if (
    own('maxResponseBytes') !== 16_384 ||
    keys.some((key) => typeof key !== 'string' || !['method', 'path', 'body', 'maxResponseBytes'].includes(key))
  ) return invalid();
  if (method === 'GET' && path === '/api/v1/session-policy' && keys.length === 3) {
    return Buffer.from(
      'GET /api/v1/session-policy HTTP/1.1\r\n' +
      'Host: coven\r\nAccept: application/json\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
    );
  }
  if (method !== 'POST' || path !== '/api/v1/sessions/restricted' || keys.length !== 4) {
    return invalid();
  }
  const source = own('body');
  let octets: unknown[];
  let length: number;
  try {
    if (!Array.isArray(source) || !Object.isFrozen(source)) return invalid();
    const size: unknown = Object.getOwnPropertyDescriptor(source, 'length')?.value;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > 1_048_576) {
      return invalid();
    }
    octets = source;
    length = size;
  } catch {
    return invalid();
  }
  const body = Buffer.alloc(length);
  for (let index = 0; index < length; index++) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(octets, String(index));
    } catch {
      return invalid();
    }
    const value: unknown = descriptor?.value;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
      return invalid();
    }
    body[index] = value;
  }
  return Buffer.concat([
    Buffer.from(
      'POST /api/v1/sessions/restricted HTTP/1.1\r\n' +
      'Host: coven\r\nAccept: application/json\r\nContent-Type: application/json\r\n' +
      `Connection: close\r\nContent-Length: ${body.length}\r\n\r\n`,
    ),
    body,
  ]);
}

function transportFailureCode(error: unknown): CovenSessionPolicyErrorCode {
  if (isOperationAbortedError(error)) return 'aborted';
  if (isOperationTimeoutError(error)) return 'timeout';
  if (error instanceof OperationConfigurationError) return 'invalid_options';
  if (isCovenIpcError(error)) {
    const code: unknown = Object.getOwnPropertyDescriptor(error, 'code')?.value;
    if (code === 'timeout') return 'timeout';
    if (code === 'invalid_response' || code === 'frame_limit' || code === 'body_limit') {
      return 'invalid_response';
    }
  }
  return 'transport_error';
}

/** Unix only. Native connected-peer validation is mandatory, never inferred from metadata. */
export function createCovenSessionPolicyUnixTransport(
  discovered: CovenDiscoveredEndpoint,
  options: CovenSessionPolicyUnixTransportOptions,
): CovenSessionPolicyTransport {
  if (process.platform === 'win32' || discovered.endpoint.kind === 'windowsNamedPipe') {
    throw new CovenSessionPolicyError('unsupported_platform', 'sessionPolicy.discover', 'not_attempted');
  }
  const access = createCovenUnixSocketAccess(discovered, options);
  return {
    async request(request, context) {
      const startedAt = performance.now();
      const wire = requestBytes(request);
      const operation = request.method === 'GET' ? 'sessionPolicy.discover' : 'sessionPolicy.launchRestricted';
      if (
        context === undefined ||
        (context.deadline !== undefined && !Number.isFinite(context.deadline))
      ) {
        throw new CovenSessionPolicyError('invalid_options', operation, 'not_attempted');
      }
      const deadline = Math.min(context.deadline ?? startedAt + 5_000, startedAt + 300_000);
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        throw new CovenSessionPolicyError('timeout', operation, 'not_attempted');
      }
      try {
        return await runOperation(
          { system: 'coven', operation },
          { signal: context.signal, timeoutMs: Math.ceil(remaining) },
          async (scope) => {
            const bounded: OperationContext = { signal: scope.signal, deadline };
            const hooks = await access.prepare(bounded);
            return requestCovenPolicyOverSocket(access.path, hooks, bounded, wire);
          },
        );
      } catch (error) {
        throw new CovenSessionPolicyError(transportFailureCode(error), operation, 'unknown');
      }
    },
  };
}
