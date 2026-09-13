import {
  createCovenSessionPolicyClient,
  createCovenSessionPolicyUnixTransport,
  isCovenSessionPolicyError,
  type CovenDiscoveredEndpoint,
  type CovenRestrictedLaunchRequest,
  type CovenSessionPolicyRefusal,
  type CovenSessionPolicyTransport,
  type CovenSessionPolicyTransportRequest,
  type CovenTransport,
} from '@opencoven/coven-client';
import { expect, test } from 'vitest';

function compileOnly(health: CovenTransport, transport: CovenSessionPolicyTransport): void {
  const client = createCovenSessionPolicyClient({ transport });
  const input: CovenRestrictedLaunchRequest = {
    contract: 'coven.session-policy.v1',
    profile: 'workspace-readonly-no-network.v1',
    requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    invocationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    expiresAtUnixMs: 1_800_000_000_000,
    launch: {
      projectRoot: '/example', cwd: '/example', familiarId: 'sage',
      harness: 'codex', launchMode: 'nonInteractive', prompt: 'Review', title: '',
    },
  };
  const outcome: Promise<CovenSessionPolicyRefusal> =
    client.launchRestricted(new TextEncoder().encode(JSON.stringify(input)));
  void outcome;
  const endpoint: CovenDiscoveredEndpoint = {
    version: 1, protocol: 'coven.daemon.v1', source: 'coven_home',
    endpoint: { kind: 'unix', path: '/example/coven.sock' },
  };
  // @ts-expect-error A real policy transport requires explicit connected-peer security.
  createCovenSessionPolicyUnixTransport(endpoint);
  // @ts-expect-error Windows security cannot be used for the Unix-only policy transport.
  createCovenSessionPolicyUnixTransport(endpoint, { security: { platform: 'windows' } });
  // @ts-expect-error Health transports cannot become policy transports.
  createCovenSessionPolicyClient({ transport: health });
  // @ts-expect-error Only raw UTF-8 bytes preserve the caller's wire representation.
  void client.launchRestricted(input);
  // @ts-expect-error No arbitrary route is exposed.
  const arbitrary: CovenSessionPolicyTransportRequest = { method: 'GET', path: '/api/v1/sessions', maxResponseBytes: 16384 };
  // @ts-expect-error Discovery cannot be POSTed.
  const wrongMethod: CovenSessionPolicyTransportRequest = { method: 'POST', path: '/api/v1/session-policy', body: [], maxResponseBytes: 16384 };
  // @ts-expect-error No accepted response belongs to v1.
  const decision: CovenSessionPolicyRefusal['decision'] = 'accepted';
  void arbitrary;
  void wrongMethod;
  void decision;
  // @ts-expect-error Harness wire IDs follow the canonical v1 schema, not arbitrary adapters.
  const harness: CovenRestrictedLaunchRequest['launch']['harness'] = 'external-adapter';
  void harness;
}

test('exports only a separate raw-byte refusal consumer', () => {
  expect(compileOnly).toBeTypeOf('function');
  expect(isCovenSessionPolicyError(new Error())).toBe(false);
  const getter = { get [Symbol.for('@opencoven/coven-client/CovenSessionPolicyError')]() {
    throw new Error('must not execute getters');
  } };
  expect(isCovenSessionPolicyError(getter)).toBe(false);
  expect(isCovenSessionPolicyError({
    [Symbol.for('@opencoven/coven-client/CovenSessionPolicyError')]: true,
  })).toBe(true);
});
