import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  parseAssertionRegistry,
  parsePlatformEvidence,
  readAssertionRegistry,
  scanConformanceEvidence,
} from '../scripts/conformance-contract.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_REGISTRY = 'e'.repeat(64);
const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const COMMIT_C = 'c'.repeat(40);
const COMMIT_D = 'd'.repeat(40);

function passingAssertion(id: string): { id: string; result: string; diagnosticId: string } {
  return { id, result: 'pass', diagnosticId: `${id}.passed` };
}

function caveAssertions(): Array<{ id: string; result: string; detail: string }> {
  return [
    { id: 'cave.one', result: 'pass', detail: '' },
    { id: 'cave.two', result: 'pass', detail: '' },
    { id: 'harness.assertion-coverage', result: 'pass', detail: 'complete' },
  ];
}

function validRecord(): Record<string, unknown> {
  const assertions = caveAssertions();
  return {
    schemaVersion: 1,
    issue: 'OpenCoven/sdk#38',
    platform: 'darwin-arm64',
    ranAt: '2026-08-28T23:30:00.000Z',
    environment: {
      os: 'darwin',
      arch: 'arm64',
      nodeVersion: 'v24.18.1',
      packageManagerVersion: 'pnpm@10.34.0',
    },
    releases: { cave: '0.3.9', coven: '0.1.0' },
    commits: { cave: COMMIT_A, coven: COMMIT_B, sdk: COMMIT_C, chat: COMMIT_D },
    digests: {
      caveAssertionEngine: SHA_A,
      caveContractFixture: SHA_B,
      hpkeVectors: 'c'.repeat(64),
      consumerLock: 'd'.repeat(64),
      assertionRegistry: SHA_REGISTRY,
      sdkTarballs: [
        { packageName: '@opencoven/sdk-core', sha256: '1'.repeat(64) },
        { packageName: '@opencoven/cave-client', sha256: '2'.repeat(64) },
        { packageName: '@opencoven/coven-client', sha256: '3'.repeat(64) },
        { packageName: '@opencoven/sdk', sha256: '4'.repeat(64) },
      ],
    },
    caveRecord: {
      harness: 'scripts/client-v1-conformance.mjs',
      issues: ['OpenCoven/coven-cave#4832'],
      scope: 'cave-only',
      ranAt: '2026-08-28T23:30:00.000Z',
      caveVersion: '0.3.9',
      commit: COMMIT_A,
      platform: 'darwin-arm64',
      nodeVersion: 'v24.18.1',
      includeTtl: true,
      authorityTakeover: {
        authorityMode: 'enforce',
        discoveryVersion: 2,
        mechanism: 'hpke-bound-v1',
      },
      notCovered: ['The SDK and Chat halves are covered by the envelope.'],
      findings: [],
      summary: { total: 3, passed: 3, failed: 0, skipped: 0, status: 'passed' },
      assertions,
    },
    sdkAssertions: [passingAssertion('sdk.one'), passingAssertion('sdk.two')],
    chatAssertions: [passingAssertion('chat.common'), passingAssertion('chat.darwin')],
    coverage: { cave: true, coven: true, sdk: true, chat: true },
    notCovered: [],
    isolation: {
      strategy: 'process-owned-temporary-roots',
      network: 'loopback-only',
      sourceCheckoutDependency: false,
      workspaceLinkDependency: false,
      retainedPrivatePaths: false,
      retainedSocketHandles: false,
      roots: [
        { id: 'cave-home', ownershipVerified: true, removedAfterRun: true },
        { id: 'coven-home', ownershipVerified: true, removedAfterRun: true },
        { id: 'consumer-home', ownershipVerified: true, removedAfterRun: true },
        {
          id: 'native-credential-store',
          ownershipVerified: true,
          removedAfterRun: true,
        },
      ],
      operatorState: [
        { id: 'cave-home', beforeSha256: SHA_A, afterSha256: SHA_A },
        { id: 'coven-home', beforeSha256: SHA_B, afterSha256: SHA_B },
        {
          id: 'native-credential-store',
          beforeSha256: 'c'.repeat(64),
          afterSha256: 'c'.repeat(64),
        },
        {
          id: 'projects',
          beforeSha256: 'd'.repeat(64),
          afterSha256: 'd'.repeat(64),
        },
      ],
    },
  };
}

function parseMutation(
  mutate: (record: Record<string, unknown>) => void,
  source = 'record.json',
): () => unknown {
  return () => {
    const record = validRecord();
    mutate(record);
    return parsePlatformEvidence(JSON.stringify(record), source);
  };
}

function validRegistryText(): string {
  return JSON.stringify({
    schemaVersion: 1,
    cave: {
      engine: 'scripts/client-v1-conformance.mjs',
      requireIncludeTtl: true,
      requireAuthorityTakeover: true,
    },
    sdk: ['sdk.one', 'sdk.two'],
    chat: {
      common: ['chat.common'],
      platforms: {
        'darwin-arm64': ['chat.darwin'],
        'linux-x64': ['chat.linux'],
        'win32-x64': ['chat.windows'],
      },
    },
  });
}

describe('assertion helper boundaries', () => {
  test('accepts a fully valid platform record', () => {
    expect(() =>
      parsePlatformEvidence(JSON.stringify(validRecord()), 'valid.json'),
    ).not.toThrow();
  });

  describe('expectTimestamp via ranAt', () => {
    test('rejects seconds-only UTC timestamps', () => {
      expect(parseMutation((record) => {
        record.ranAt = '2026-08-28T23:30:00Z';
      })).toThrow('canonical UTC ISO-8601 timestamp');
    });

    test('rejects explicit zero offsets', () => {
      expect(parseMutation((record) => {
        record.ranAt = '2026-08-28T23:30:00.000+00:00';
      })).toThrow('canonical UTC ISO-8601 timestamp');
    });

    test('rejects non-timestamps and impossible dates', () => {
      expect(parseMutation((record) => {
        record.ranAt = 'not-a-timestamp';
      })).toThrow('canonical UTC ISO-8601 timestamp');
      expect(parseMutation((record) => {
        record.ranAt = '2026-13-01T00:00:00.000Z';
      })).toThrow('canonical UTC ISO-8601 timestamp');
    });

    test('rejects oversized timestamp fields before parsing', () => {
      expect(parseMutation((record) => {
        record.ranAt = 'x'.repeat(33);
      })).toThrow('exceeds the 32-byte limit');
    });
  });

  describe('expectCommit via commits', () => {
    test('rejects short, long, and uppercase commits', () => {
      expect(parseMutation((record) => {
        record.commits = { cave: 'a'.repeat(39), coven: COMMIT_B, sdk: COMMIT_C, chat: COMMIT_D };
      })).toThrow('commits.cave is not canonical');
      expect(parseMutation((record) => {
        record.commits = { cave: 'a'.repeat(41), coven: COMMIT_B, sdk: COMMIT_C, chat: COMMIT_D };
      })).toThrow('commits.cave exceeds the 40-byte limit');
      expect(parseMutation((record) => {
        record.commits = { cave: 'A'.repeat(40), coven: COMMIT_B, sdk: COMMIT_C, chat: COMMIT_D };
      })).toThrow('commits.cave is not canonical');
    });
  });

  describe('expectSha256 via digests', () => {
    test('rejects short and non-hex digests', () => {
      expect(parseMutation((record) => {
        const digests = record.digests as Record<string, unknown>;
        digests.consumerLock = 'a'.repeat(63);
      })).toThrow('digests.consumerLock is not canonical');
      expect(parseMutation((record) => {
        const digests = record.digests as Record<string, unknown>;
        digests.consumerLock = 'g'.repeat(64);
      })).toThrow('digests.consumerLock is not canonical');
    });
  });

  describe('expectTarballs via digests.sdkTarballs', () => {
    test('rejects incomplete tarball sets', () => {
      expect(parseMutation((record) => {
        const digests = record.digests as Record<string, unknown>;
        digests.sdkTarballs = (digests.sdkTarballs as unknown[]).slice(0, 3);
      })).toThrow('must contain the four canonical SDK tarballs');
    });

    test('rejects non-canonical package order and names', () => {
      expect(parseMutation((record) => {
        const digests = record.digests as Record<string, unknown>;
        const tarballs = digests.sdkTarballs as Array<{ packageName: string; sha256: string }>;
        const first = tarballs[0];
        const second = tarballs[1];
        if (first !== undefined && second !== undefined) {
          tarballs[0] = second;
          tarballs[1] = first;
        }
      })).toThrow('must use canonical package order');
      expect(parseMutation((record) => {
        const digests = record.digests as Record<string, unknown>;
        const tarballs = digests.sdkTarballs as Array<{ packageName: string; sha256: string }>;
        const first = tarballs[0];
        if (first !== undefined) first.packageName = '@opencoven/rogue';
      })).toThrow('must use canonical package order');
    });

    test('rejects malformed tarball digests', () => {
      expect(parseMutation((record) => {
        const digests = record.digests as Record<string, unknown>;
        const tarballs = digests.sdkTarballs as Array<{ packageName: string; sha256: string }>;
        const first = tarballs[0];
        if (first !== undefined) first.sha256 = '1'.repeat(63);
      })).toThrow('sdkTarballs[0].sha256 is not canonical');
    });
  });

  describe('expectCoverage via coverage', () => {
    test('rejects missing, false, and extra scopes', () => {
      expect(parseMutation((record) => {
        record.coverage = { cave: true, coven: true, sdk: true };
      })).toThrow('coverage is missing required field "chat"');
      expect(parseMutation((record) => {
        record.coverage = { cave: true, coven: true, sdk: true, chat: false };
      })).toThrow('coverage.chat must be true');
      expect(parseMutation((record) => {
        record.coverage = {
          cave: true,
          coven: true,
          sdk: true,
          chat: true,
          extra: true,
        };
      })).toThrow('coverage has unexpected field "extra"');
    });
  });

  describe('expectNotCovered via notCovered', () => {
    test('never allows SDK or Chat to be declared not covered', () => {
      expect(parseMutation((record) => {
        record.notCovered = [
          { scopeId: 'sdk', diagnosticId: 'scope.sdk.not-covered' },
        ];
      })).toThrow('scopeId "sdk" is not allowlisted');
      expect(parseMutation((record) => {
        record.notCovered = [
          { scopeId: 'chat', diagnosticId: 'scope.chat.not-covered' },
        ];
      })).toThrow('scopeId "chat" is not allowlisted');
    });

    test('rejects unknown, duplicated, and non-canonical entries', () => {
      expect(parseMutation((record) => {
        record.notCovered = [
          { scopeId: 'pairing', diagnosticId: 'scope.pairing.not-covered' },
        ];
      })).toThrow('scopeId "pairing" is not allowlisted');
      expect(parseMutation((record) => {
        record.notCovered = [
          { scopeId: 'write-apis', diagnosticId: 'scope.write-apis.not-covered' },
          { scopeId: 'write-apis', diagnosticId: 'scope.write-apis.repeat' },
        ];
      })).toThrow('duplicate scopeId "write-apis"');
      expect(parseMutation((record) => {
        record.notCovered = [
          { scopeId: 'write-apis', diagnosticId: 'Not-Canonical' },
        ];
      })).toThrow('diagnosticId is not canonical');
    });

    test('accepts the allowlisted non-release scopes', () => {
      expect(parseMutation((record) => {
        record.notCovered = [
          { scopeId: 'write-apis', diagnosticId: 'scope.write-apis.not-covered' },
          { scopeId: 'oauth-ui', diagnosticId: 'scope.oauth-ui.not-covered' },
          { scopeId: 'remote-peer', diagnosticId: 'scope.remote-peer.not-covered' },
          {
            scopeId: 'cross-process-pairing',
            diagnosticId: 'scope.cross-process-pairing.not-covered',
          },
        ];
      })).not.toThrow();
    });
  });

  describe('expectIsolation via isolation', () => {
    test('rejects non-array roots and incomplete root entries', () => {
      expect(parseMutation((record) => {
        const isolation = record.isolation as Record<string, unknown>;
        isolation.roots = 'cave-home';
      })).toThrow('isolation.roots must be an array');
      expect(parseMutation((record) => {
        const isolation = record.isolation as Record<string, unknown>;
        isolation.roots = [
          { id: 'cave-home', ownershipVerified: true },
        ];
      })).toThrow('roots[0] is missing required field "removedAfterRun"');
    });

    test('rejects malformed operator-state digests', () => {
      expect(parseMutation((record) => {
        const isolation = record.isolation as Record<string, unknown>;
        isolation.operatorState = [
          { id: 'cave-home', beforeSha256: 'abc', afterSha256: 'abc' },
        ];
      })).toThrow('operatorState[0].beforeSha256 is not canonical');
    });

    test('rejects unexpected isolation fields', () => {
      expect(parseMutation((record) => {
        const isolation = record.isolation as Record<string, unknown>;
        isolation.retainEverything = true;
      })).toThrow('isolation has unexpected field "retainEverything"');
    });
  });

  describe('expectCrossAssertion via assertion lists', () => {
    test('rejects missing diagnostic IDs', () => {
      expect(parseMutation((record) => {
        record.sdkAssertions = [{ id: 'sdk.one', result: 'pass' }];
      })).toThrow('sdkAssertions[0] is missing required field "diagnosticId"');
    });

    test('rejects unknown results and non-canonical IDs', () => {
      expect(parseMutation((record) => {
        record.sdkAssertions = [
          { id: 'sdk.one', result: 'unknown', diagnosticId: 'sdk.one.x' },
        ];
      })).toThrow('result must be pass, fail, or skip');
      expect(parseMutation((record) => {
        record.sdkAssertions = [passingAssertion('SDK.ONE')];
      })).toThrow('sdkAssertions[0].id is not canonical');
    });

    test('rejects oversized diagnostic IDs', () => {
      expect(parseMutation((record) => {
        record.sdkAssertions = [
          passingAssertion('sdk.one'),
          { id: 'sdk.two', result: 'pass', diagnosticId: `sdk.two.${'x'.repeat(190)}` },
        ];
      })).toThrow('sdkAssertions[1].diagnosticId exceeds the 192-byte limit');
    });
  });

  describe('expectAssertionArray bounds', () => {
    test('rejects non-arrays and overlong assertion lists', () => {
      expect(parseMutation((record) => {
        record.sdkAssertions = { id: 'sdk.one' };
      })).toThrow('sdkAssertions must be an array');
      expect(parseMutation((record) => {
        record.sdkAssertions = Array.from(
          { length: 1_001 },
          () => passingAssertion('sdk.one'),
        );
      })).toThrow('sdkAssertions exceeds the 1000-entry limit');
    });
  });

  describe('expectString bounds and canonicality', () => {
    test('rejects empty and oversized platform identifiers', () => {
      expect(parseMutation((record) => {
        record.platform = '';
      })).toThrow('platform must be a non-empty string');
      expect(parseMutation((record) => {
        record.platform = 'x'.repeat(33);
      })).toThrow('platform exceeds the 32-byte limit');
    });

    test('rejects oversized release versions', () => {
      expect(parseMutation((record) => {
        record.releases = { cave: 'x'.repeat(65), coven: '0.1.0' };
      })).toThrow('releases.cave exceeds the 64-byte limit');
    });
  });

  describe('expectBoolean', () => {
    test('rejects non-boolean isolation flags', () => {
      expect(parseMutation((record) => {
        const isolation = record.isolation as Record<string, unknown>;
        isolation.workspaceLinkDependency = 'no';
      })).toThrow('isolation.workspaceLinkDependency must be a boolean');
      expect(parseMutation((record) => {
        const isolation = record.isolation as Record<string, unknown>;
        isolation.retainedSocketHandles = 1;
      })).toThrow('isolation.retainedSocketHandles must be a boolean');
    });
  });

  describe('expectCaveRecord and expectExactObject', () => {
    test('rejects array cave records', () => {
      expect(parseMutation((record) => {
        record.caveRecord = [];
      })).toThrow('caveRecord must be a JSON object');
    });

    test('rejects non-object environments and unexpected top-level fields', () => {
      expect(parseMutation((record) => {
        record.environment = [];
      })).toThrow('environment must be a JSON object');
      expect(parseMutation((record) => {
        record.platforms = ['darwin-arm64'];
      })).toThrow('has unexpected field "platforms"');
    });
  });

  describe('canonical runtime and issue bindings', () => {
    test('rejects wrong issue, schema version, and toolchain identities', () => {
      expect(parseMutation((record) => {
        record.issue = 'OpenCoven/sdk#39';
      })).toThrow('issue must be "OpenCoven/sdk#38"');
      expect(parseMutation((record) => {
        record.schemaVersion = 2;
      })).toThrow('schemaVersion must be 1');
      expect(parseMutation((record) => {
        const environment = record.environment as Record<string, unknown>;
        environment.nodeVersion = 'v22.11.0';
      })).toThrow('environment.nodeVersion is not canonical');
      expect(parseMutation((record) => {
        const environment = record.environment as Record<string, unknown>;
        environment.packageManagerVersion = 'pnpm@10.0.0';
      })).toThrow('environment.packageManagerVersion is not canonical');
    });
  });

  describe('duplicate JSON keys', () => {
    test('rejects duplicated platform fields', () => {
      const record = validRecord();
      const text = JSON.stringify(record).replace(
        '"platform":"darwin-arm64"',
        '"platform":"darwin-arm64","platform":"darwin-arm64"',
      );
      expect(() =>
        parsePlatformEvidence(text, 'duplicate.json'),
      ).toThrow('duplicate.json contains duplicate JSON object key "platform"');
    });
  });
});

describe('assertion registry boundaries', () => {
  test('accepts the valid registry text', () => {
    expect(() =>
      parseAssertionRegistry(validRegistryText(), 'registry.json'),
    ).not.toThrow();
  });

  test('rejects schema, engine, and requirement drift', () => {
    expect(() =>
      parseAssertionRegistry(
        validRegistryText().replace('"schemaVersion":1', '"schemaVersion":2'),
        'registry.json',
      ),
    ).toThrow('registry.json.schemaVersion must be 1');
    expect(() =>
      parseAssertionRegistry(
        validRegistryText().replace(
          'scripts/client-v1-conformance.mjs',
          'scripts/rogue-engine.mjs',
        ),
        'registry.json',
      ),
    ).toThrow('registry.json.cave.engine must name Cave\'s authoritative harness');
    expect(() =>
      parseAssertionRegistry(
        validRegistryText().replace('"requireIncludeTtl":true', '"requireIncludeTtl":false'),
        'registry.json',
      ),
    ).toThrow('registry.json.cave must require TTL and authority-takeover assertions');
    expect(() =>
      parseAssertionRegistry(
        validRegistryText().replace(
          '"requireAuthorityTakeover":true',
          '"requireAuthorityTakeover":false',
        ),
        'registry.json',
      ),
    ).toThrow('registry.json.cave must require TTL and authority-takeover assertions');
  });

  test('rejects incomplete platform matrices', () => {
    expect(() =>
      parseAssertionRegistry(
        validRegistryText().replace(
          /,"win32-x64":\["chat\.windows"\]/u,
          '',
        ),
        'registry.json',
      ),
    ).toThrow('registry.json.chat.platforms is missing required field "win32-x64"');
  });

  test('rejects duplicate, non-canonical, and overlapping assertion IDs', () => {
    expect(() =>
      parseAssertionRegistry(
        validRegistryText().replace(
          '"sdk":["sdk.one","sdk.two"]',
          '"sdk":["sdk.one","sdk.one"]',
        ),
        'registry.json',
      ),
    ).toThrow('duplicate assertion id "sdk.one"');
    expect(() =>
      parseAssertionRegistry(
        validRegistryText().replace(
          '"sdk":["sdk.one","sdk.two"]',
          '"sdk":["sdk.one","SDK.TWO"]',
        ),
        'registry.json',
      ),
    ).toThrow('non-canonical assertion id "SDK.TWO"');
    expect(() =>
      parseAssertionRegistry(
        validRegistryText().replace(
          '"darwin-arm64":["chat.darwin"]',
          '"darwin-arm64":["chat.common"]',
        ),
        'registry.json',
      ),
    ).toThrow('repeats common Chat assertion "chat.common" for darwin-arm64');
  });

  test('rejects duplicate JSON keys and invalid JSON', () => {
    expect(() =>
      parseAssertionRegistry(
        validRegistryText().replace(
          '"sdk":["sdk.one","sdk.two"]',
          '"sdk":["sdk.one"],"sdk":["sdk.two"]',
        ),
        'registry.json',
      ),
    ).toThrow('duplicate JSON object key "sdk"');
    expect(() =>
      parseAssertionRegistry('{not json', 'registry.json'),
    ).toThrow('Cannot parse registry.json');
  });
});

describe('evidence scan boundaries', () => {
  describe('forbidden evidence fields', () => {
    const forbiddenFields = [
      'attachment',
      'attachments',
      'authorization',
      'bearer',
      'body',
      'commandOutput',
      'content',
      'credential',
      'credentialValue',
      'message',
      'messageBody',
      'pairingSecret',
      'prompt',
      'requestBody',
      'responseBody',
      'secret',
      'socketHandle',
      'stderr',
      'stdout',
    ];

    test.each(forbiddenFields)('rejects field %s', (field) => {
      expect(() =>
        scanConformanceEvidence({ [field]: 'redacted' }),
      ).toThrow(`forbidden evidence field "${field}"`);
      expect(() =>
        scanConformanceEvidence({ nested: { [field.toUpperCase()]: 'redacted' } }),
      ).toThrow(`forbidden evidence field "${field.toUpperCase()}"`);
    });
  });

  describe('secret-shaped values', () => {
    test('rejects bearer tokens', () => {
      expect(() =>
        scanConformanceEvidence({ detail: 'Bearer abcdefghijklmnop' }),
      ).toThrow('possible secret');
    });

    test('rejects authorization and pairing-secret headers with values', () => {
      expect(() =>
        scanConformanceEvidence({ detail: 'authorization: "abcdefgh12345678"' }),
      ).toThrow('possible secret');
      expect(() =>
        scanConformanceEvidence({ detail: 'x-coven-pairing-secret: abcdefgh12345678' }),
      ).toThrow('possible secret');
      expect(() =>
        scanConformanceEvidence({ detail: 'X-COVEN-CAVE-TOKEN=abcdefgh12345678' }),
      ).toThrow('possible secret');
    });

    test('rejects private key material', () => {
      expect(() =>
        scanConformanceEvidence({ detail: '-----BEGIN PRIVATE KEY-----' }),
      ).toThrow('possible secret');
      expect(() =>
        scanConformanceEvidence({ detail: '-----BEGIN OPENSSH PRIVATE KEY-----' }),
      ).toThrow('possible secret');
      expect(() =>
        scanConformanceEvidence({ detail: '-----BEGIN RSA PRIVATE KEY-----' }),
      ).toThrow('possible secret');
    });

    test('rejects JWT-shaped values', () => {
      expect(() =>
        scanConformanceEvidence({
          detail:
            'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
        }),
      ).toThrow('possible secret');
    });

    test('rejects provider token formats', () => {
      expect(() =>
        scanConformanceEvidence({ detail: 'token ghp_abcdefghijklmnopqrstuvwxyz012345' }),
      ).toThrow('possible secret');
      expect(() =>
        scanConformanceEvidence({ detail: 'token npm_aaaaaaaaaaaaaaaaaaaaaaaa' }),
      ).toThrow('possible secret');
    });

    test('rejects long credential-shaped runs', () => {
      expect(() =>
        scanConformanceEvidence({ detail: `run ${'A'.repeat(43)}` }),
      ).toThrow('possible secret');
    });

    test('accepts ordinary API paths and header names without values', () => {
      expect(() =>
        scanConformanceEvidence({ detail: 'Bearer' }),
      ).not.toThrow();
      expect(() =>
        scanConformanceEvidence({ detail: 'authorization header omitted' }),
      ).not.toThrow();
    });
  });

  describe('private filesystem paths', () => {
    const privatePaths = [
      '/Users/alice/.coven',
      '/home/alice/.coven',
      '/root/.coven',
      '/private/var/scratch',
      '/tmp/scratch',
      '/var/folders/ab/scratch',
      '/var/tmp/scratch',
      '/Applications/Coven.app',
      '/Library/Preferences',
      '/System/Library',
      '/Volumes/USB',
      '/dev/console',
      '/etc/passwd',
      '/opt/toolchain',
      '/run/user/501/coven.sock',
      '/srv/evidence',
      '/usr/local/bin',
      'C:\\Users\\alice\\AppData',
      '\\\\fileserver\\share\\evidence.json',
    ];

    test.each(privatePaths)('rejects path %s', (path) => {
      expect(() => scanConformanceEvidence({ detail: path })).toThrow(
        'private filesystem path',
      );
    });

    test('accepts repository-relative and API paths', () => {
      expect(() =>
        scanConformanceEvidence({
          detail: 'docs/workflows/client-v1-cross-repository-conformance.md',
        }),
      ).not.toThrow();
      expect(() =>
        scanConformanceEvidence({ detail: '/api/client/v1/health' }),
      ).not.toThrow();
    });
  });

  describe('structural evidence bounds', () => {
    test('rejects non-JSON values', () => {
      expect(() =>
        scanConformanceEvidence({ detail: undefined }),
      ).toThrow('contains a non-JSON value');
      expect(() =>
        scanConformanceEvidence({ detail: Number.NaN }),
      ).toThrow('contains a non-JSON value');
      expect(() =>
        scanConformanceEvidence({ detail: new Date('2026-08-28T00:00:00.000Z') }),
      ).toThrow('contains a non-JSON value');
    });

    test('rejects depth beyond 32 levels', () => {
      const root: Record<string, unknown> = {};
      let current = root;
      for (let level = 0; level < 34; level += 1) {
        const next: Record<string, unknown> = {};
        current.nested = next;
        current = next;
      }
      expect(() => scanConformanceEvidence(root)).toThrow(
        'exceeds the 32-level depth limit',
      );
    });

    test('rejects structures beyond 50000 nodes', () => {
      const items = Array.from({ length: 50_001 }, (_unused, index) => index);
      expect(() => scanConformanceEvidence({ items })).toThrow(
        'exceeds the 50000-node limit',
      );
    });

    test('rejects strings beyond 16 KiB', () => {
      expect(() =>
        scanConformanceEvidence({ detail: 'x'.repeat(16_385) }),
      ).toThrow('string exceeds the 16384-byte evidence limit');
    });
  });
});

describe('committed assertion registry', () => {
  test('parses the shipped registry and covers the read-only journey', () => {
    const registry = readAssertionRegistry(
      resolve(
        workspaceRoot,
        'conformance/client-v1-cross-repository-assertions.json',
      ),
    );
    expect(registry.schemaVersion).toBe(1);
    expect(registry.cave.engine).toBe('scripts/client-v1-conformance.mjs');
    for (const id of [
      'sdk.cave.pairing.wrong-secret-refused',
      'sdk.cave.pairing.replay-refused',
      'sdk.cave.exchange.missing-content-length-refused',
      'sdk.cave.revocation.messages-refused',
      'sdk.coven.structured-errors',
      'sdk.native.trust-binding-missing-fails-closed',
    ]) {
      expect(registry.sdk).toContain(id);
    }
    for (const id of [
      'chat.coven.windows.constructed-pipe-refused',
      'chat.coven.windows.foreign-pipe-refused',
      'chat.native.windows-credential-manager.isolated',
    ]) {
      expect(registry.chat.platforms['win32-x64']).toContain(id);
    }
    for (const id of [
      'chat.cave.bearer-never-enters-webview',
      'chat.coven.executable.trusted',
      'chat.evidence.no-command-output',
      'chat.native.trust-provider-unavailable-fails-closed',
    ]) {
      expect(registry.chat.common).toContain(id);
    }
  });
});
