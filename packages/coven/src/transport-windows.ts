import { createConnection } from 'node:net';

import { parseDiscoveryEndpoint } from '@opencoven/sdk-core';

import {
  CovenIpcError,
  type CovenDiscoveredEndpoint,
} from './discovery.js';
import type { CovenTransport } from './transport.js';
import {
  awaitOperationStep,
  requestCovenHealthOverSocket,
  type CovenHealthTransportLimits,
  type CovenSocket,
  type CovenSocketConnector,
} from './transport-unix.js';

export interface CovenWindowsPipeIdentity {
  ownerIdentity: string;
  ownerOnly: boolean;
  pipeIdentity: string;
  serverProcessId: number;
  processCreationTime: string;
}

export interface CovenWindowsPipeOwnershipAdapter {
  currentUserIdentity(): Promise<string>;
  inspect(path: string): Promise<CovenWindowsPipeIdentity>;
  inspectConnected(
    path: string,
    socket: CovenSocket,
  ): Promise<CovenWindowsPipeIdentity>;
}

export interface CovenWindowsTransportDependencies {
  connect?: CovenSocketConnector;
}

export interface CovenWindowsTransportOptions
  extends CovenHealthTransportLimits {
  dependencies?: CovenWindowsTransportDependencies;
  ownership: CovenWindowsPipeOwnershipAdapter;
}

function unsafe(
  message: string,
  phase: 'validate_endpoint' | 'revalidate_endpoint',
): CovenIpcError {
  return new CovenIpcError('unsafe_endpoint', message, { phase });
}

function ownerMismatch(
  phase: 'validate_endpoint' | 'revalidate_endpoint',
): CovenIpcError {
  return new CovenIpcError(
    'owner_mismatch',
    'Coven named pipe owner did not match the current user.',
    { phase },
  );
}

function validWindowsEndpoint(
  discovered: CovenDiscoveredEndpoint,
): Extract<
  CovenDiscoveredEndpoint['endpoint'],
  { kind: 'windowsNamedPipe' }
> {
  if (
    discovered.version !== 1 ||
    discovered.protocol !== 'coven.daemon.v1' ||
    discovered.endpoint.kind !== 'windowsNamedPipe'
  ) {
    throw unsafe(
      'Coven Windows transport requires a reviewed local named pipe.',
      'validate_endpoint',
    );
  }
  try {
    const endpoint = parseDiscoveryEndpoint(discovered.endpoint);
    if (endpoint.kind !== 'windowsNamedPipe') {
      throw new TypeError('not a Windows named pipe');
    }
    return endpoint;
  } catch {
    throw unsafe(
      'Coven Windows transport received an unsafe named pipe.',
      'validate_endpoint',
    );
  }
}

function validateIdentity(
  identity: CovenWindowsPipeIdentity,
  currentUserIdentity: string,
  phase: 'validate_endpoint' | 'revalidate_endpoint',
): void {
  if (
    typeof identity.ownerIdentity !== 'string' ||
    identity.ownerIdentity.length === 0 ||
    typeof identity.pipeIdentity !== 'string' ||
    identity.pipeIdentity.length === 0 ||
    identity.ownerOnly !== true
  ) {
    throw unsafe('Coven named pipe ACL or identity was unsafe.', phase);
  }
  if (identity.ownerIdentity !== currentUserIdentity) {
    throw ownerMismatch(phase);
  }
  if (
    !Number.isSafeInteger(identity.serverProcessId) ||
    identity.serverProcessId <= 0
  ) {
    throw unsafe('Coven named pipe server identity was invalid.', phase);
  }
  if (
    typeof identity.processCreationTime !== 'string' ||
    identity.processCreationTime.length === 0
  ) {
    throw unsafe('Coven named pipe process identity was invalid.', phase);
  }
}

function samePipeIdentity(
  initial: CovenWindowsPipeIdentity,
  connected: CovenWindowsPipeIdentity,
): boolean {
  return (
    initial.ownerIdentity === connected.ownerIdentity &&
    initial.pipeIdentity === connected.pipeIdentity &&
    connected.serverProcessId === initial.serverProcessId &&
    connected.processCreationTime === initial.processCreationTime
  );
}

function matchesDiscoveredFreshness(
  discovered: CovenDiscoveredEndpoint,
  connected: CovenWindowsPipeIdentity,
): boolean {
  const freshness = discovered.freshness;
  if (freshness === undefined) {
    return true;
  }
  return (
    connected.serverProcessId === freshness.daemonPid &&
    (freshness.processCreationTime === undefined ||
      connected.processCreationTime === freshness.processCreationTime)
  );
}

function defaultWindowsConnector(path: string): CovenSocket {
  return createConnection({ path });
}

export function createCovenWindowsTransport(
  discovered: CovenDiscoveredEndpoint,
  options: CovenWindowsTransportOptions,
): CovenTransport {
  const endpoint = validWindowsEndpoint(discovered);
  const connect = options.dependencies?.connect ?? defaultWindowsConnector;

  return {
    async health(context) {
      const [currentUserIdentity, initial] = await awaitOperationStep(
        async () => {
          try {
            return await Promise.all([
              options.ownership.currentUserIdentity(),
              options.ownership.inspect(endpoint.path),
            ]);
          } catch {
            throw unsafe(
              'Coven named pipe ownership could not be validated.',
              'validate_endpoint',
            );
          }
        },
        context,
        'validate_endpoint',
      );
      if (
        typeof currentUserIdentity !== 'string' ||
        currentUserIdentity.length === 0
      ) {
        throw ownerMismatch('validate_endpoint');
      }
      validateIdentity(initial, currentUserIdentity, 'validate_endpoint');
      if (
        discovered.owner?.kind === 'windows' &&
        discovered.owner.identity !== currentUserIdentity
      ) {
        throw ownerMismatch('validate_endpoint');
      }

      return requestCovenHealthOverSocket(
        endpoint.path,
        {
          connect,
          async revalidate(socket) {
            let connected: CovenWindowsPipeIdentity;
            try {
              connected = await options.ownership.inspectConnected(
                endpoint.path,
                socket,
              );
            } catch {
              throw unsafe(
                'Connected Coven named pipe ownership could not be validated.',
                'revalidate_endpoint',
              );
            }
            validateIdentity(
              connected,
              currentUserIdentity,
              'revalidate_endpoint',
            );
            if (
              !samePipeIdentity(initial, connected) ||
              !matchesDiscoveredFreshness(discovered, connected)
            ) {
              throw unsafe(
                'Coven named pipe identity changed during connection.',
                'revalidate_endpoint',
              );
            }
          },
        },
        context,
        options,
      );
    },
  };
}
