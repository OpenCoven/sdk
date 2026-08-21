import * as core from '@opencoven/sdk-core';
import { describe, expect, test } from 'vitest';

type DiscoveryEndpoint =
  | { kind: 'http'; url: string }
  | { kind: 'unix'; path: string }
  | { kind: 'windowsNamedPipe'; path: string };

interface DiscoveryRecord {
  version: 1;
  protocol: 'opencoven.discovery.v1';
  profile: 'cave' | 'coven';
  endpoint: DiscoveryEndpoint;
}

type DiscoveryErrorCode =
  | 'invalid_discovery_value'
  | 'unexpected_discovery_field'
  | 'unsupported_discovery_endpoint_kind'
  | 'invalid_discovery_endpoint'
  | 'unsupported_discovery_version'
  | 'unsupported_discovery_protocol'
  | 'unsupported_discovery_profile';

type EndpointParser = (value: unknown) => DiscoveryEndpoint;
type RecordParser = (value: unknown) => DiscoveryRecord;

function getEndpointParser(): EndpointParser {
  const parser = (
    core as {
      parseDiscoveryEndpoint?: EndpointParser;
    }
  ).parseDiscoveryEndpoint;

  expect(parser).toBeTypeOf('function');
  if (parser === undefined) {
    throw new Error('parseDiscoveryEndpoint was not exported');
  }

  return parser;
}

function getRecordParser(): RecordParser {
  const parser = (
    core as {
      parseDiscoveryRecord?: RecordParser;
    }
  ).parseDiscoveryRecord;

  expect(parser).toBeTypeOf('function');
  if (parser === undefined) {
    throw new Error('parseDiscoveryRecord was not exported');
  }

  return parser;
}

function expectDiscoveryError(
  action: () => unknown,
  code: DiscoveryErrorCode,
): void {
  let caught: unknown;

  try {
    action();
  } catch (error) {
    caught = error;
  }

  expect(caught).toMatchObject({
    name: 'DiscoveryContractError',
    code,
    retryable: false,
  });
}

describe('discovery endpoint contract', () => {
  test.each([
    'http://127.0.0.1:4111',
    'http://127.255.0.42:65535/',
    'http://[::1]:80/',
    'http://[0:0:0:0:0:0:0:1]:4111',
  ])('accepts an explicit loopback HTTP endpoint: %s', (url) => {
    expect(getEndpointParser()({ kind: 'http', url })).toEqual({
      kind: 'http',
      url,
    });
  });

  test.each([
    'https://127.0.0.1:4111/',
    'http://192.168.1.10:4111/',
    'http://example.com:4111/',
    'http://localhost:4111/',
    'http://user@127.0.0.1:4111/',
    'http://user:password@127.0.0.1:4111/',
    'http://127.0.0.1/',
    'http://127.0.0.1:0/',
    'http://127.0.0.1:65536/',
    'http://127.0.0.1:4111/health',
    'http://127.0.0.1:4111/?ready=true',
    'http://127.0.0.1:4111/#status',
    'http://127.0.0.1:4111/%2fhealth',
    'http://127.0.0.1:4111/%5chealth',
  ])('rejects an unsafe HTTP endpoint: %s', (url) => {
    expectDiscoveryError(
      () => getEndpointParser()({ kind: 'http', url }),
      'invalid_discovery_endpoint',
    );
  });

  test.each([
    '/var/run/opencoven/coven.sock',
    '/Users/example/.opencoven/cave.sock',
  ])('accepts a normalized absolute Unix socket path: %s', (path) => {
    expect(getEndpointParser()({ kind: 'unix', path })).toEqual({
      kind: 'unix',
      path,
    });
  });

  test.each([
    'relative/coven.sock',
    '/var/run/../coven.sock',
    '//var/run/coven.sock',
    '/var/run/coven.sock\0suffix',
    '/',
  ])('rejects an unsafe Unix socket path: %s', (path) => {
    expectDiscoveryError(
      () => getEndpointParser()({ kind: 'unix', path }),
      'invalid_discovery_endpoint',
    );
  });

  test('accepts a canonical local Windows named pipe', () => {
    const path = '\\\\.\\pipe\\opencoven-coven';

    expect(getEndpointParser()({ kind: 'windowsNamedPipe', path })).toEqual({
      kind: 'windowsNamedPipe',
      path,
    });
  });

  test.each([
    '\\\\server\\pipe\\opencoven-coven',
    '\\\\?\\pipe\\opencoven-coven',
    '\\\\.\\pipe\\',
    '\\\\.\\pipe\\..\\opencoven-coven',
    '\\\\.\\pipe\\opencoven/coven',
    '\\\\.\\pipe\\opencoven\0coven',
  ])('rejects a remote or unsafe Windows named pipe: %s', (path) => {
    expectDiscoveryError(
      () => getEndpointParser()({ kind: 'windowsNamedPipe', path }),
      'invalid_discovery_endpoint',
    );
  });

  test.each([
    null,
    [],
    'http://127.0.0.1:4111/',
    new (class CustomEndpoint {
      readonly kind = 'unix';
      readonly path = '/var/run/coven.sock';
    })(),
  ])('rejects malformed or custom endpoint values', (value) => {
    expectDiscoveryError(
      () => getEndpointParser()(value),
      'invalid_discovery_value',
    );
  });

  test('rejects unknown kinds and unexpected endpoint fields', () => {
    expectDiscoveryError(
      () => getEndpointParser()({ kind: 'udp', url: 'udp://127.0.0.1:4111' }),
      'unsupported_discovery_endpoint_kind',
    );
    expectDiscoveryError(
      () =>
        getEndpointParser()({
          kind: 'http',
          url: 'http://127.0.0.1:4111/',
          token: 'must-not-be-accepted',
        }),
      'unexpected_discovery_field',
    );
  });
});

describe('versioned discovery record contract', () => {
  test.each(['cave', 'coven'] as const)(
    'accepts a supported %s discovery profile',
    (profile) => {
      const record: DiscoveryRecord = {
        version: 1,
        protocol: 'opencoven.discovery.v1',
        profile,
        endpoint: {
          kind: profile === 'cave' ? 'http' : 'unix',
          ...(profile === 'cave'
            ? { url: 'http://127.0.0.1:4111/' }
            : { path: '/var/run/opencoven/coven.sock' }),
        } as DiscoveryEndpoint,
      };

      expect(getRecordParser()(record)).toEqual(record);
    },
  );

  test('delegates endpoint validation', () => {
    expectDiscoveryError(
      () =>
        getRecordParser()({
          version: 1,
          protocol: 'opencoven.discovery.v1',
          profile: 'cave',
          endpoint: {
            kind: 'http',
            url: 'https://127.0.0.1:4111/',
          },
        }),
      'invalid_discovery_endpoint',
    );
  });

  test.each([
    null,
    [],
    'record',
    new (class CustomRecord {
      readonly version = 1;
      readonly protocol = 'opencoven.discovery.v1';
      readonly profile = 'coven';
      readonly endpoint = {
        kind: 'unix',
        path: '/var/run/opencoven/coven.sock',
      };
    })(),
  ])('rejects malformed, array, and custom record values', (value) => {
    expectDiscoveryError(
      () => getRecordParser()(value),
      'invalid_discovery_value',
    );
  });

  test('rejects unsupported version, protocol, and profile fields', () => {
    const record = {
      version: 1,
      protocol: 'opencoven.discovery.v1',
      profile: 'coven',
      endpoint: {
        kind: 'unix',
        path: '/var/run/opencoven/coven.sock',
      },
    };

    expectDiscoveryError(
      () => getRecordParser()({ ...record, version: 2 }),
      'unsupported_discovery_version',
    );
    expectDiscoveryError(
      () => getRecordParser()({ ...record, protocol: 'opencoven.discovery.v2' }),
      'unsupported_discovery_protocol',
    );
    expectDiscoveryError(
      () => getRecordParser()({ ...record, profile: 'cli' }),
      'unsupported_discovery_profile',
    );
  });

  test.each(['secret', 'token', 'credential', 'secretKey'])(
    'rejects secret-bearing unexpected field %s',
    (field) => {
      expectDiscoveryError(
        () =>
          getRecordParser()({
            version: 1,
            protocol: 'opencoven.discovery.v1',
            profile: 'coven',
            endpoint: {
              kind: 'unix',
              path: '/var/run/opencoven/coven.sock',
            },
            [field]: 'must-not-be-accepted',
          }),
        'unexpected_discovery_field',
      );
    },
  );

  test('rejects non-JSON fields even when they are hidden or accessor-backed', () => {
    const hiddenSecretRecord = {
      version: 1,
      protocol: 'opencoven.discovery.v1',
      profile: 'coven',
      endpoint: {
        kind: 'unix',
        path: '/var/run/opencoven/coven.sock',
      },
    };
    Object.defineProperty(hiddenSecretRecord, 'secret', {
      value: 'must-not-be-accepted',
    });

    expectDiscoveryError(
      () => getRecordParser()(hiddenSecretRecord),
      'unexpected_discovery_field',
    );

    const accessorRecord = {
      version: 1,
      protocol: 'opencoven.discovery.v1',
      profile: 'coven',
      get endpoint() {
        return {
          kind: 'unix',
          path: '/var/run/opencoven/coven.sock',
        };
      },
    };

    expectDiscoveryError(
      () => getRecordParser()(accessorRecord),
      'invalid_discovery_value',
    );
  });
});
