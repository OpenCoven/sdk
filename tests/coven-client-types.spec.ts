import {
  COVEN_DAEMON_PROTOCOL,
  createCovenUnixTransport,
  createDiscoveredCovenClient,
  discoverCovenEndpoint,
  type CovenDiscoveredEndpoint,
  type CovenUnixPeerIdentityAdapter,
} from '@opencoven/coven-client';
import { describe, expect, test } from 'vitest';

const endpoint: CovenDiscoveredEndpoint = {
  version: 1,
  protocol: COVEN_DAEMON_PROTOCOL,
  source: 'coven_home',
  endpoint: { kind: 'unix', path: '/var/run/opencoven/coven.sock' },
};

const peerIdentity: CovenUnixPeerIdentityAdapter = {
  inspectConnected: (socket) => {
    void socket.destroyed;
    return Promise.resolve({ device: 7, inode: 11, ownerUid: 501 });
  },
};

function compileOnly(): void {
  void discoverCovenEndpoint();
  void createDiscoveredCovenClient({
    transportSecurity: {
      platform: 'unix',
      peerIdentity,
    },
  });
  void createCovenUnixTransport(endpoint, {
    security: {
      platform: 'unix',
      peerIdentity,
    },
  });

  // @ts-expect-error A discovered production client requires platform transport security.
  void createDiscoveredCovenClient();
  // @ts-expect-error Unix transport construction requires connected-peer security.
  void createCovenUnixTransport(endpoint);
}

describe('Coven client type safety', () => {
  test('keeps transport-security requirements in the public type surface', () => {
    expect(compileOnly).toBeTypeOf('function');
  });
});
