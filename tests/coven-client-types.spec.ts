import {
  COVEN_DAEMON_PROTOCOL,
  createCovenUnixTransport,
  createCovenWindowsTransport,
  createDiscoveredCovenClient,
  discoverCovenEndpoint,
  type CovenDiscoveredEndpoint,
  type CovenUnixPeerIdentityAdapter,
  type CovenUnixTransportSecurityProvider,
  type CovenTransportSecurityProvider,
  type CovenWindowsPipeOwnershipAdapter,
  type CovenWindowsTransportSecurityProvider,
} from '@opencoven/coven-client';
import { describe, expect, test } from 'vitest';

const unixEndpoint: CovenDiscoveredEndpoint = {
  version: 1,
  protocol: COVEN_DAEMON_PROTOCOL,
  source: 'coven_home',
  endpoint: { kind: 'unix', path: '/var/run/opencoven/coven.sock' },
};

const windowsEndpoint: CovenDiscoveredEndpoint = {
  version: 1,
  protocol: COVEN_DAEMON_PROTOCOL,
  source: 'config_paths',
  endpoint: { kind: 'windowsNamedPipe', path: '\\\\.\\pipe\\coven-daemon.sock' },
};

const peerIdentity: CovenUnixPeerIdentityAdapter = {
  inspectConnected: (socket) => {
    void socket.destroyed;
    return Promise.resolve({ device: 7, inode: 11, ownerUid: 501 });
  },
};

const ownership: CovenWindowsPipeOwnershipAdapter = {
  currentUserIdentity: () => Promise.resolve('S-1-5-21-current-user'),
  inspect: () =>
    Promise.resolve({
      ownerIdentity: 'S-1-5-21-current-user',
      ownerOnly: true,
      pipeIdentity: 'pipe-identity-1',
      serverProcessId: 42,
      processCreationTime: '100',
    }),
  inspectConnected: () =>
    Promise.resolve({
      ownerIdentity: 'S-1-5-21-current-user',
      ownerOnly: true,
      pipeIdentity: 'pipe-identity-1',
      serverProcessId: 42,
      processCreationTime: '100',
    }),
};

const unixSecurity: CovenUnixTransportSecurityProvider = {
  platform: 'unix',
  peerIdentity,
};

const windowsSecurity: CovenWindowsTransportSecurityProvider = {
  platform: 'windows',
  ownership,
};

const platformSecurity: readonly CovenTransportSecurityProvider[] = [
  unixSecurity,
  windowsSecurity,
];

function compileOnly(): void {
  void platformSecurity;
  void discoverCovenEndpoint();
  void createDiscoveredCovenClient({
    transportSecurity: unixSecurity,
  });
  void createCovenUnixTransport(unixEndpoint, {
    security: unixSecurity,
  });
  void createCovenWindowsTransport(windowsEndpoint, {
    security: windowsSecurity,
  });

  // @ts-expect-error A discovered production client requires platform transport security.
  void createDiscoveredCovenClient();
  // @ts-expect-error Unix transport construction requires connected-peer security.
  void createCovenUnixTransport(unixEndpoint);
  // @ts-expect-error Unix transport construction rejects Windows security providers.
  void createCovenUnixTransport(unixEndpoint, { security: windowsSecurity });
  // @ts-expect-error Windows transport construction requires pipe ownership security.
  void createCovenWindowsTransport(windowsEndpoint);
  // @ts-expect-error Windows transport security must use the discriminated wrapper.
  void createCovenWindowsTransport(windowsEndpoint, { ownership });
  // @ts-expect-error Windows transport construction rejects Unix security providers.
  void createCovenWindowsTransport(windowsEndpoint, { security: unixSecurity });
}

describe('Coven client type safety', () => {
  test('keeps transport-security requirements in the public type surface', () => {
    expect(compileOnly).toBeTypeOf('function');
  });
});
