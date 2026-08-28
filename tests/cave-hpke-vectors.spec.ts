import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  CAVE_HPKE_LIMITS,
  CAVE_HPKE_REQUEST_INFO,
  CAVE_HPKE_RESPONSE_INFO,
  canonicalCaveHpkeRoute,
  caveHpkeBase64UrlDecode,
  createCaveHpkeBoundRequest,
} from '../packages/cave/src/hpke-bound-v1-node.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vector = JSON.parse(
  readFileSync(
    resolve(root, 'packages/cave/fixtures/hpke-bound-v1-vectors.json'),
    'utf8',
  ),
) as {
  authority: {
    keyId: string;
    publicKey: string;
    responsePublicKey: string;
  };
  inputs: {
    authorization: {
      kind: 'pairing-secret';
      value: string;
    };
    instanceId: string;
    issuedAt: number;
    method: string;
    recipientIkm: string;
    requestEkmIkm: string;
    requestNonce: string;
    responseRecipientIkm: string;
    route: string;
    runtimeNonce: string;
  };
  request: {
    aad: string;
    ciphertext: string;
    enc: string;
    info: string;
    plaintext: string;
  };
  response: {
    aad: string;
    bodyUtf8: string;
    ciphertext: string;
    enc: string;
    info: string;
  };
  suite: {
    aeadId: 2;
    kdfId: 1;
    kemId: 32;
  };
};

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

describe('Cave hpke-bound-v1 deterministic vectors', () => {
  test('reproduces exact Base request bytes and opens the Auth response', async () => {
    const sealed = await createCaveHpkeBoundRequest({
      authority: {
        mechanism: 'hpke-bound-v1',
        mode: 'advertise',
        keyId: vector.authority.keyId,
        publicKey: vector.authority.publicKey,
        suite: vector.suite,
      },
      instanceId: vector.inputs.instanceId,
      runtimeNonce: vector.inputs.runtimeNonce,
      operation: 'pairing.exchange',
      url: `http://127.0.0.1:3020${vector.inputs.route}`,
      method: vector.inputs.method,
      issuedAt: vector.inputs.issuedAt,
      authorization: vector.inputs.authorization,
      deterministic: {
        requestNonce: Buffer.from(
          vector.inputs.requestNonce,
          'base64url',
        ),
        requestEkm: Buffer.from(vector.inputs.requestEkmIkm, 'hex'),
        responseRecipientIkm: Buffer.from(
          vector.inputs.responseRecipientIkm,
          'hex',
        ),
      },
    });

    expect(base64Url(CAVE_HPKE_REQUEST_INFO)).toBe(vector.request.info);
    expect(base64Url(CAVE_HPKE_RESPONSE_INFO)).toBe(vector.response.info);
    expect(base64Url(sealed.requestAad)).toBe(vector.request.aad);
    expect(base64Url(sealed.responseAad)).toBe(vector.response.aad);
    expect(sealed.request.headers.get('x-coven-client-v1-authority-enc')).toBe(
      vector.request.enc,
    );
    expect(
      sealed.request.headers.get('x-coven-client-v1-authority-ciphertext'),
    ).toBe(vector.request.ciphertext);
    expect(base64Url(sealed.responsePublicKey)).toBe(
      vector.authority.responsePublicKey,
    );

    const opened = await sealed.open(
      Response.json(
        {
          version: 1,
          mechanism: 'hpke-bound-v1',
          keyId: vector.authority.keyId,
          requestNonce: vector.inputs.requestNonce,
          enc: vector.response.enc,
          ciphertext: vector.response.ciphertext,
        },
        {
          status: 200,
          headers: {
            'content-type':
              'application/vnd.opencoven.client-v1.hpke-bound-v1+json',
          },
        },
      ),
    );

    expect(opened.status).toBe(200);
    expect(opened.headers).toEqual({ contentType: 'application/json' });
    expect(new TextDecoder().decode(opened.body)).toBe(
      vector.response.bodyUtf8,
    );
  });

  test('enforces canonical base64url, route, and protocol bounds', async () => {
    expect(CAVE_HPKE_LIMITS).toEqual({
      rawKeyBytes: 32,
      encodedKeyCharacters: 43,
      requestPlaintextBytes: 1_024,
      requestCiphertextBytes: 2_048,
      requestBodyBytes: 65_536,
      responsePlaintextBytes: 8_388_608,
      responseCiphertextBytes: 8_388_624,
      responseEnvelopeBytes: 11_185_056,
      canonicalRouteBytes: 2_048,
      instanceIdBytes: 256,
    });
    expect(
      canonicalCaveHpkeRoute(
        new URL(
          'http://127.0.0.1/api/client/v1/familiars?b=two+words&a=%21*&a=z',
        ),
      ),
    ).toBe('/api/client/v1/familiars?a=%21%2A&a=z&b=two%20words');
    expect(() =>
      canonicalCaveHpkeRoute(
        new URL('http://127.0.0.1/api/client/v1/%66amiliars'),
      ),
    ).toThrowError('Cave HPKE transport authentication failed.');
    expect(() =>
      caveHpkeBase64UrlDecode(`${vector.inputs.requestNonce}=`, {
        minimum: 32,
        maximum: 32,
      }),
    ).toThrowError('Cave HPKE transport authentication failed.');

    await expect(
      createCaveHpkeBoundRequest({
        authority: {
          mechanism: 'hpke-bound-v1',
          mode: 'advertise',
          keyId: vector.authority.keyId,
          publicKey: vector.authority.publicKey,
          suite: vector.suite,
        },
        instanceId: 'i'.repeat(257),
        runtimeNonce: vector.inputs.runtimeNonce,
        operation: 'pairing.exchange',
        url: `http://127.0.0.1:3020${vector.inputs.route}`,
        method: vector.inputs.method,
        body: new Uint8Array(65_537),
        authorization: vector.inputs.authorization,
      }),
    ).rejects.toThrowError('Cave HPKE transport authentication failed.');
  });

  test('rejects oversized and structurally altered outer responses before Auth open', async () => {
    const sealed = await createCaveHpkeBoundRequest({
      authority: {
        mechanism: 'hpke-bound-v1',
        mode: 'advertise',
        keyId: vector.authority.keyId,
        publicKey: vector.authority.publicKey,
        suite: vector.suite,
      },
      instanceId: vector.inputs.instanceId,
      runtimeNonce: vector.inputs.runtimeNonce,
      operation: 'pairing.exchange',
      url: `http://127.0.0.1:3020${vector.inputs.route}`,
      method: vector.inputs.method,
      issuedAt: vector.inputs.issuedAt,
      authorization: vector.inputs.authorization,
    });

    await expect(
      sealed.open(
        new Response('{}', {
          status: 200,
          headers: {
            'content-length': String(CAVE_HPKE_LIMITS.responseEnvelopeBytes + 1),
            'content-type':
              'application/vnd.opencoven.client-v1.hpke-bound-v1+json',
          },
        }),
      ),
    ).rejects.toThrowError('Cave HPKE transport authentication failed.');
    await expect(
      sealed.open(
        Response.json(
          {
            version: 1,
            mechanism: 'hpke-bound-v1',
            keyId: vector.authority.keyId,
            requestNonce: sealed.binding.requestNonce,
            enc: vector.response.enc,
            ciphertext: vector.response.ciphertext,
            extra: true,
          },
          {
            headers: {
              'content-type':
                'application/vnd.opencoven.client-v1.hpke-bound-v1+json',
            },
          },
        ),
      ),
    ).rejects.toThrowError('Cave HPKE transport authentication failed.');
  });

  test('rejects noncanonical encoded pathname segments', () => {
    for (const pathname of [
      '/api/client/v1/conversations/conversation%2fone',
      '/api/client/v1/conversations/conversation%3fone',
      '/api/client/v1/conversations/%e4%bc%9a%e8%a9%b1',
      '/api/client/v1/conversations/conversation%2Done',
      '/api/client/v1/conversations/%21',
      '/api/client/v1/conversations/$value',
      '/api/client/v1/conversations/conversation%252Fone',
      '/api/client/v1/conversations/conversation%255Cone',
      '/api/client/v1/conversations/conversation%5Cone',
      '/api/client/v1/conversations/conversation%',
      '/api/client/v1/conversations/conversation%GG',
      '/api/client/v1/conversations/%E9',
    ]) {
      expect(() =>
        canonicalCaveHpkeRoute(
          new URL(`http://127.0.0.1:3020${pathname}`),
        ),
      ).toThrowError('Cave HPKE transport authentication failed.');
    }
  });

  test('rejects dot, empty, and backslash pathname aliases', () => {
    for (const pathname of [
      'api/client/v1/projects',
      '/api/client/v1/',
      '/api//client/v1/projects',
      '/api/client/v1/conversations/.',
      '/api/client/v1/conversations/..',
      '/api/client/v1/conversations/%2E',
      '/api/client/v1/conversations/%2e%2E',
      '/api/client/v1/conversations/conversation\\one',
    ]) {
      expect(() =>
        canonicalCaveHpkeRoute({
          pathname,
          searchParams: new URLSearchParams(),
        } as URL),
      ).toThrowError('Cave HPKE transport authentication failed.');
    }
  });
});
