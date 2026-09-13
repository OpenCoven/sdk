import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import {
  createCovenSessionPolicyClient,
  type CovenSessionPolicyTransport,
} from '@opencoven/coven-client';
import { afterEach, expect, test, vi } from 'vitest';

const manifest = {
  contract: 'coven.session-policy.v1',
  admissionTimeUnixMs: 1_799_999_700_000,
  encoding: 'UTF-8',
  trailingNewline: 'LF',
  request: {
    file: 'request.json',
    bytes: 421,
    digest: 'sha256:c61bac56f84d1f3fddd5e70da35a7e8906f9bd4bac769b5d4ad61769dae83fdb',
  },
  refusal: {
    file: 'refusal.json',
    status: 409,
    bytes: 315,
    digest: 'sha256:1bf9aa54fb9a3409c0930bec116cee455082de3d87aa6a3a9fab31e9866750f7',
  },
  discovery: {
    file: 'discovery.json',
    status: 200,
    bytes: 133,
    digest: 'sha256:ffb4acff5c59079dd2c1477c5f4c1ecb167faa29e1090488cfd64cac5af84306',
  },
} as const;

function fixture(file: string): Buffer {
  const path = new URL(`../packages/coven/fixtures/session-policy-v1/${file}`, import.meta.url);
  expect(existsSync(path), `Missing canonical session policy fixture: ${file}`).toBe(true);
  return readFileSync(path);
}

afterEach(() => { vi.restoreAllMocks(); });

test('pins fixture provenance and docs to the reviewed producer commit', () => {
  const commit = '8ae022a70ce2506e0e3b4345b8e567fe94380ce5';
  const sha256 = '71b24b45e5e7a9fedd1fc188ce3e15b43ca9e91312aa70685e03895af500b5cc';
  const provenance: unknown = JSON.parse(fixture('manifest.provenance.json').toString('utf8'));
  expect(provenance).toEqual({
    repository: 'https://github.com/OpenCoven/coven',
    commit,
    fixturePath: 'spec/coven-session-policy/v1/fixtures/manifest.json',
    sha256,
  });
  expect(createHash('sha256').update(fixture('manifest.json')).digest('hex')).toBe(sha256);
  const readme = readFileSync(new URL('../packages/coven/README.md', import.meta.url), 'utf8');
  expect(readme).toContain(
    `https://github.com/OpenCoven/coven/blob/${commit}/spec/coven-session-policy/v1/README.md`,
  );
});

test('pins the fixed-time canonical fixture manifest and exact LF bytes', () => {
  const metadata: unknown = JSON.parse(fixture('manifest.json').toString('utf8'));
  expect(metadata).toEqual(manifest);
  for (const item of [manifest.request, manifest.refusal, manifest.discovery]) {
    const body = fixture(item.file);
    expect(body.length).toBe(item.bytes);
    expect(body.at(-1)).toBe(0x0a);
    expect(`sha256:${createHash('sha256').update(body).digest('hex')}`).toBe(item.digest);
  }
});

test.each([true, false])('consumes the canonical request with response LF=%s at fixed admission time', async (includeResponseLf) => {
  vi.spyOn(Date, 'now').mockReturnValue(manifest.admissionTimeUnixMs);
  const body = fixture(manifest.request.file);
  const refusalFile = fixture(manifest.refusal.file);
  const refusal = includeResponseLf ? refusalFile : refusalFile.subarray(0, -1);
  const request = vi.fn<CovenSessionPolicyTransport['request']>((sent) => {
    expect(sent.method).toBe('POST');
    expect(sent.path).toBe('/api/v1/sessions/restricted');
    if (sent.method !== 'POST') throw new Error('Unexpected discovery');
    expect(Buffer.from(sent.body)).toEqual(body);
    expect(`sha256:${createHash('sha256').update(Buffer.from(sent.body)).digest('hex')}`)
      .toBe(manifest.request.digest);
    return Promise.resolve({ status: manifest.refusal.status, body: refusal });
  });
  await expect(createCovenSessionPolicyClient({ transport: { request } }).launchRestricted(body))
    .resolves.toEqual({
      contract: manifest.contract,
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      invocationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      requestDigest: manifest.request.digest,
      decision: 'rejected',
      code: 'enforcement_unavailable',
      admission: 'not_started',
    });
  expect(request).toHaveBeenCalledTimes(1);
});

test('consumes canonical discovery only as unavailable metadata', async () => {
  const request = vi.fn<CovenSessionPolicyTransport['request']>(() => Promise.resolve({
    status: manifest.discovery.status,
    body: fixture(manifest.discovery.file),
  }));
  await expect(createCovenSessionPolicyClient({ transport: { request } }).discover())
    .resolves.toEqual({
      contract: manifest.contract,
      enforcement: 'unavailable',
      supportedProfiles: [],
      reason: 'no_verified_enforcement_backend',
    });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]?.[0].path).toBe('/api/v1/session-policy');
});
