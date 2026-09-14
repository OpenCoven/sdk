import {
  isOperationAbortedError,
  isOperationTimeoutError,
  runOperation,
  type OperationDefaults,
  type OperationOptions,
} from '@opencoven/sdk-core';

import { CovenAutomationsClient, type CovenAutomationsTransport } from './automations.js';
import { createCovenAutomationsUnixTransport } from './automations-unix.js';
import { createCovenAutomationsWindowsTransport } from './automations-windows.js';
import { CovenClientError, isCovenClientError, normalizeCovenError } from './client-errors.js';
import {
  CovenIpcError,
  discoverCovenEndpoint,
  type DiscoverCovenEndpointOptions,
} from './discovery.js';
import { COVEN_DAEMON_PROTOCOL, type CovenHealth, type CovenHealthResponse } from './schemas.js';
import type {
  CovenTransport,
  CovenTransportSecurityProvider,
} from './transport.js';
import {
  createCovenUnixTransport,
  type CovenUnixTransportSecurityProvider,
  type CovenUnixTransportOptions,
} from './transport-unix.js';
import {
  createCovenWindowsTransport,
  type CovenWindowsTransportSecurityProvider,
  type CovenWindowsTransportOptions,
} from './transport-windows.js';

export { CovenClientError, isCovenClientError, normalizeCovenError } from './client-errors.js';

export interface CovenClientOptions {
  transport: CovenTransport;
  automationsTransport?: CovenAutomationsTransport;
  operation?: OperationDefaults;
}

interface CovenDiscoveredClientBaseOptions {
  discovery?: DiscoverCovenEndpointOptions;
  operation?: OperationDefaults;
  automations?: boolean;
}

export type CovenDiscoveredUnixTransportOptions = Omit<
  CovenUnixTransportOptions,
  'security'
>;

export type CovenDiscoveredWindowsTransportOptions = Omit<
  CovenWindowsTransportOptions,
  'security'
>;

export interface CovenDiscoveredUnixClientOptions
  extends CovenDiscoveredClientBaseOptions {
  transportSecurity: CovenUnixTransportSecurityProvider;
  unix?: CovenDiscoveredUnixTransportOptions;
  windows?: never;
}

export interface CovenDiscoveredWindowsClientOptions
  extends CovenDiscoveredClientBaseOptions {
  transportSecurity: CovenWindowsTransportSecurityProvider;
  unix?: never;
  windows?: CovenDiscoveredWindowsTransportOptions;
}

export type CovenDiscoveredClientOptions =
  | CovenDiscoveredUnixClientOptions
  | CovenDiscoveredWindowsClientOptions;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidHealthResponse(): CovenClientError {
  return new CovenClientError(
    normalizeCovenError(
      {
        code: 'invalid_response',
      },
      'health',
    ),
  );
}

function validateCapabilities(value: unknown): value is CovenHealthResponse['capabilities'] {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.sessions === 'boolean' &&
    typeof value.events === 'boolean' &&
    (value.eventCursor === undefined || typeof value.eventCursor === 'string') &&
    value.structuredErrors === true
  );
}

function validateHealthResponse(response: unknown): response is CovenHealthResponse {
  if (!isObject(response)) {
    return false;
  }

  if (response.ok !== true) {
    return false;
  }

  if (typeof response.apiVersion !== 'string' || typeof response.covenVersion !== 'string') {
    return false;
  }

  return validateCapabilities(response.capabilities);
}

export class CovenClient {
  readonly automations: CovenAutomationsClient | undefined;
  readonly #transport: CovenTransport;
  readonly #operation: OperationDefaults | undefined;

  constructor(options: CovenClientOptions) {
    this.#transport = options.transport;
    this.#operation = options.operation;
    this.automations = options.automationsTransport === undefined
      ? undefined
      : new CovenAutomationsClient({
        transport: options.automationsTransport,
        ...(options.operation === undefined ? {} : { operation: options.operation }),
      });
  }

  requireAutomations(): CovenAutomationsClient {
    if (this.automations === undefined) {
      throw new CovenClientError(normalizeCovenError({ code: 'not_configured' }, 'automations'));
    }
    return this.automations;
  }

  async health(options: OperationOptions = {}): Promise<CovenHealth> {
    const timeoutMs = options.timeoutMs ?? this.#operation?.timeoutMs;
    const observer = options.observer ?? this.#operation?.observer;
    const operationOptions: OperationOptions = {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(observer === undefined ? {} : { observer }),
    };

    try {
      return await runOperation(
        {
          system: 'coven',
          operation: 'health',
        },
        operationOptions,
        async (context) => {
          try {
            const response: unknown = await this.#transport.health(context);

            if (
              !validateHealthResponse(response) ||
              response.apiVersion !== COVEN_DAEMON_PROTOCOL
            ) {
              throw invalidHealthResponse();
            }

            return { status: 'ok' };
          } catch (error) {
            if (isCovenClientError(error)) {
              throw error;
            }

            throw new CovenClientError(normalizeCovenError(error, 'health'), {
              cause: error,
            });
          }
        },
      );
    } catch (error) {
      if (isCovenClientError(error)) {
        throw error;
      }

      if (isOperationTimeoutError(error) || isOperationAbortedError(error)) {
        throw new CovenClientError(normalizeCovenError(error, 'health'), {
          cause: error,
        });
      }

      throw error;
    }
  }
}

export function createCovenClient(options: CovenClientOptions): CovenClient {
  return new CovenClient(options);
}

export async function createDiscoveredCovenClient(
  options: CovenDiscoveredClientOptions,
): Promise<CovenClient> {
  const transportSecurity: CovenTransportSecurityProvider | undefined =
    options?.transportSecurity;
  if (
    transportSecurity?.platform !== 'unix' &&
    transportSecurity?.platform !== 'windows'
  ) {
    throw new CovenIpcError(
      'unsafe_endpoint',
      'Platform transport security is required.',
      { phase: 'validate_endpoint' },
    );
  }
  const endpoint = await discoverCovenEndpoint(options.discovery);
  let transport: CovenTransport;
  let automationsTransport: CovenAutomationsTransport | undefined;

  if (endpoint.endpoint.kind === 'unix') {
    if (transportSecurity.platform !== 'unix') {
      throw new CovenIpcError(
        'unsafe_endpoint',
        'Unix transport security is required for the discovered endpoint.',
        { phase: 'validate_endpoint' },
      );
    }
    transport = createCovenUnixTransport(endpoint, {
      ...options.unix,
      security: transportSecurity,
    });
    if (options.automations === true) {
      automationsTransport = createCovenAutomationsUnixTransport(endpoint, {
        ...options.unix,
        security: transportSecurity,
      });
    }
  } else {
    if (transportSecurity.platform !== 'windows') {
      throw new CovenIpcError(
        'unsafe_endpoint',
        'Windows transport security is required for the discovered endpoint.',
        { phase: 'validate_endpoint' },
      );
    }
    transport = createCovenWindowsTransport(endpoint, {
      ...options.windows,
      security: transportSecurity,
    });
    if (options.automations === true) {
      automationsTransport = createCovenAutomationsWindowsTransport(endpoint, {
        ...options.windows,
        security: transportSecurity,
      });
    }
  }

  return new CovenClient({
    transport,
    ...(automationsTransport === undefined ? {} : { automationsTransport }),
    ...(options.operation === undefined ? {} : { operation: options.operation }),
  });
}
