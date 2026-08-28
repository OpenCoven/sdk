import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  CAVE_HPKE_HEADERS,
  CAVE_HPKE_LIMITS,
  CAVE_HPKE_RESPONSE_INFO,
  CAVE_HPKE_RESPONSE_MEDIA_TYPE,
  canonicalCaveHpkeRoute,
  caveBase64UrlDecode,
  caveBase64UrlEncode,
  caveHpkeKeyId,
  createCaveHpkeBoundRequest,
  createCaveHpkeSuite,
} from '../packages/cave/src/hpke-bound-v1.js';
import { parseCaveDiscoveryRecord } from '../packages/cave/src/discovery-record-node.js';
import type { CaveDiscoveredEndpointV2 } from '../packages/cave/src/discovery.js';

interface HpkeVector {
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
    bodySha256: string;
    instanceId: string;
    issuedAt: number;
    method: string;
    recipientIkm: string;
    requestEkmIkm: string;
    requestNonce: string;
    responseEkmIkm: string;
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
    plaintext: string;
  };
  suite: {
    aeadId: 2;
    kdfId: 1;
    kemId: 32;
  };
}

const FIXTURE_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'cave',
  'fixtures',
);
const VECTOR_PATH = join(FIXTURE_DIRECTORY, 'hpke-bound-v1-vectors.json');
const VECTOR_DIGEST_PATH = join(
  FIXTURE_DIRECTORY,
  'hpke-bound-v1-vectors.sha256',
);

function fromHex(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/u.test(value)) {
    throw new TypeError('Fixture hex value was malformed.');
  }
  return Uint8Array.from(Buffer.from(value, 'hex'));
}

async function loadVector(): Promise<{
  bytes: Uint8Array;
  digest: string;
  vector: HpkeVector;
}> {
  const [bytes, digest] = await Promise.all([
    readFile(VECTOR_PATH),
    readFile(VECTOR_DIGEST_PATH, 'utf8'),
  ]);
  return {
    bytes,
    digest: digest.trim(),
    vector: JSON.parse(bytes.toString('utf8')) as HpkeVector,
  };
}

function discoveredAuthority(vector: HpkeVector): CaveDiscoveredEndpointV2 {
  return {
    version: 2,
    endpoint: {
      kind: 'http',
      url: 'http://127.0.0.1:3020',
    },
    freshness: {
      pid: 4_321,
      nonce: vector.inputs.runtimeNonce,
      startedAt: '2026-08-25T15:42:58.109Z',
    },
    record: {
      path: '/tmp/cave/client-v1-discovery.json',
      device: 1,
      inode: 2,
    },
    authority: {
      mechanism: 'hpke-bound-v1',
      mode: 'enforce',
      keyId: vector.authority.keyId,
      publicKey: vector.authority.publicKey,
      suite: {
        kemId: vector.suite.kemId,
        kdfId: vector.suite.kdfId,
        aeadId: vector.suite.aeadId,
      },
    },
  };
}

async function createVectorRequest(vector: HpkeVector) {
  return await createCaveHpkeBoundRequest({
    discovered: discoveredAuthority(vector),
    instanceId: vector.inputs.instanceId,
    url: `http://127.0.0.1:3020${vector.inputs.route}`,
    method: vector.inputs.method,
    authorization: vector.inputs.authorization,
    issuedAt: vector.inputs.issuedAt,
    requestNonce: caveBase64UrlDecode(vector.inputs.requestNonce, {
      minimum: 32,
      maximum: 32,
    }),
    requestEkm: fromHex(vector.inputs.requestEkmIkm),
    responseRecipientIkm: fromHex(vector.inputs.responseRecipientIkm),
  });
}

function vectorResponse(vector: HpkeVector): Response {
  return new Response(
    JSON.stringify({
      version: 1,
      mechanism: 'hpke-bound-v1',
      keyId: vector.authority.keyId,
      requestNonce: vector.inputs.requestNonce,
      enc: vector.response.enc,
      ciphertext: vector.response.ciphertext,
    }),
    {
      status: 200,
      headers: {
        'content-type': CAVE_HPKE_RESPONSE_MEDIA_TYPE,
      },
    },
  );
}

async function authenticatedResponse(
  vector: HpkeVector,
  request: Awaited<ReturnType<typeof createVectorRequest>>,
  body: Uint8Array,
): Promise<Response> {
  const suite = createCaveHpkeSuite();
  const authority = await suite.kem.deriveKeyPair(
    fromHex(vector.inputs.recipientIkm),
  );
  const responseRecipient = await suite.kem.deriveKeyPair(
    fromHex(vector.inputs.responseRecipientIkm),
  );
  const sender = await suite.createSenderContext({
    recipientPublicKey: responseRecipient.publicKey,
    senderKey: authority.privateKey,
    info: CAVE_HPKE_RESPONSE_INFO,
    ekm: await suite.kem.deriveKeyPair(
      fromHex(vector.inputs.responseEkmIkm),
    ),
  });
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      body: caveBase64UrlEncode(body),
      headers: { contentType: 'application/json' },
      requestNonce: request.binding.requestNonce,
      status: 200,
      version: 1,
    }),
  );
  const ciphertext = new Uint8Array(
    await sender.seal(plaintext, request.responseAad),
  );
  return new Response(
    JSON.stringify({
      version: 1,
      mechanism: 'hpke-bound-v1',
      keyId: request.binding.keyId,
      requestNonce: request.binding.requestNonce,
      enc: caveBase64UrlEncode(sender.enc),
      ciphertext: caveBase64UrlEncode(ciphertext),
    }),
    {
      status: 200,
      headers: {
        'content-type': CAVE_HPKE_RESPONSE_MEDIA_TYPE,
      },
    },
  );
}

describe('Cave hpke-bound-v1 producer interoperability', () => {
  test('vendors the exact producer vector bytes', async () => {
    const { bytes, digest } = await loadVector();
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
    expect(digest).toBe(
      'f806967291de12175277b6b24ac3c7bba912ae760fd8227fb21b1a4d5f5e6797',
    );
  });

  test('matches the producer request and opens its Auth-mode response', async () => {
    const { vector } = await loadVector();
    const request = await createVectorRequest(vector);

    expect(caveBase64UrlEncode(request.requestAad)).toBe(vector.request.aad);
    expect(caveBase64UrlEncode(request.responseAad)).toBe(vector.response.aad);
    expect(request.headers.get(CAVE_HPKE_HEADERS.enc)).toBe(vector.request.enc);
    expect(request.headers.get(CAVE_HPKE_HEADERS.ciphertext)).toBe(
      vector.request.ciphertext,
    );
    expect(request.headers.get(CAVE_HPKE_HEADERS.mechanism)).toBe(
      'hpke-bound-v1',
    );
    expect(request.headers.get('authorization')).toBeNull();
    expect(request.headers.get('x-coven-pairing-secret')).toBeNull();

    const opened = await request.open(vectorResponse(vector), {
      maxBodyBytes: 64 * 1_024,
    });
    expect(opened.status).toBe(200);
    expect(new TextDecoder().decode(opened.body)).toBe(vector.response.bodyUtf8);
  });

  test('fails closed on unauthenticated or mutated responses', async () => {
    const { vector } = await loadVector();
    const request = await createVectorRequest(vector);

    await expect(
      request.open(
        new Response(vector.response.bodyUtf8, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
        { maxBodyBytes: 64 * 1_024 },
      ),
    ).rejects.toMatchObject({ code: 'reconcile_required' });

    await expect(
      request.open(
        new Response(null, {
          status: 200,
          headers: { 'content-type': CAVE_HPKE_RESPONSE_MEDIA_TYPE },
        }),
        { maxBodyBytes: 64 * 1_024 },
      ),
    ).rejects.toMatchObject({ code: 'reconcile_required' });

    const mutatedCiphertext = `${vector.response.ciphertext.slice(0, -1)}${
      vector.response.ciphertext.endsWith('A') ? 'B' : 'A'
    }`;
    await expect(
      request.open(
        new Response(
          JSON.stringify({
            version: 1,
            mechanism: 'hpke-bound-v1',
            keyId: vector.authority.keyId,
            requestNonce: vector.inputs.requestNonce,
            enc: vector.response.enc,
            ciphertext: mutatedCiphertext,
          }),
          {
            status: 200,
            headers: { 'content-type': CAVE_HPKE_RESPONSE_MEDIA_TYPE },
          },
        ),
        { maxBodyBytes: 64 * 1_024 },
      ),
    ).rejects.toMatchObject({ code: 'reconcile_required' });

    await expect(
      request.open(
        new Response(
          JSON.stringify({
            version: 1,
            mechanism: 'hpke-bound-v1',
            keyId: vector.authority.keyId,
            requestNonce: vector.inputs.requestNonce,
            enc: vector.response.enc,
            ciphertext: vector.response.ciphertext,
            unexpected: true,
          }),
          {
            status: 200,
            headers: { 'content-type': CAVE_HPKE_RESPONSE_MEDIA_TYPE },
          },
        ),
        { maxBodyBytes: 64 * 1_024 },
      ),
    ).rejects.toMatchObject({ code: 'reconcile_required' });
  });

  test('bounds encrypted envelope reads by the caller body limit', async () => {
    const { vector } = await loadVector();
    const request = await createVectorRequest(vector);
    const chunk = new Uint8Array(64 * 1_024);
    let bytesRead = 0;
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          bytesRead += chunk.byteLength;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      }),
      {
        status: 200,
        headers: {
          'content-type': CAVE_HPKE_RESPONSE_MEDIA_TYPE,
        },
      },
    );

    await expect(
      request.open(response, { maxBodyBytes: 64 }),
    ).rejects.toMatchObject({ code: 'reconcile_required' });
    expect(bytesRead).toBeLessThanOrEqual(chunk.byteLength * 2);
    expect(cancelled).toBe(true);
  });

  test.each([
    ['decoded body one byte over the limit', 65],
    ['encoded body beyond the pre-decode bound', 67],
  ] as const)('classifies an oversized authenticated %s as body_limit', async (_case, bodyBytes) => {
    const { vector } = await loadVector();
    const request = await createVectorRequest(vector);
    const response = await authenticatedResponse(
      vector,
      request,
      new Uint8Array(bodyBytes),
    );

    const error = await request.open(response, {
      maxBodyBytes: 64,
    }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      code: 'body_limit',
      message: 'Cave response exceeded its size limit.',
      retryable: false,
      statusCode: 200,
    });
    expect(error).not.toHaveProperty('cause');
  });

  test('classifies response-stream cancellation as aborted', async () => {
    const { vector } = await loadVector();
    const request = await createVectorRequest(vector);
    const controller = new AbortController();
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      }),
      {
        status: 200,
        headers: {
          'content-type': CAVE_HPKE_RESPONSE_MEDIA_TYPE,
        },
      },
    );

    const result = request.open(response, {
      maxBodyBytes: 64,
      signal: controller.signal,
    }).catch((error: unknown) => error);
    controller.abort(new Error('caller cancellation detail'));

    await expect(result).resolves.toMatchObject({
      code: 'aborted',
      message: 'Cave HPKE response was aborted.',
      retryable: false,
    });
    await expect(result).resolves.not.toHaveProperty('cause');
    expect(cancelled).toBe(true);
  });

  test('rejects malformed HPKE inputs before emitting a request', async () => {
    const { vector } = await loadVector();
    const discovered = discoveredAuthority(vector);
    const request = {
      discovered,
      instanceId: vector.inputs.instanceId,
      url: `http://127.0.0.1:3020${vector.inputs.route}`,
      method: vector.inputs.method,
      authorization: vector.inputs.authorization,
      issuedAt: vector.inputs.issuedAt,
      requestNonce: caveBase64UrlDecode(vector.inputs.requestNonce, {
        minimum: 32,
        maximum: 32,
      }),
      requestEkm: fromHex(vector.inputs.requestEkmIkm),
      responseRecipientIkm: fromHex(vector.inputs.responseRecipientIkm),
    } as const;

    expect(() =>
      caveBase64UrlDecode('=', { minimum: 0, maximum: 32 }),
    ).toThrowError(/canonical base64url/u);
    expect(() =>
      caveBase64UrlDecode('', { minimum: 32, maximum: 32 }),
    ).toThrowError(/invalid length/u);
    expect(() => caveHpkeKeyId(new Uint8Array(31))).toThrowError(
      /public key length/u,
    );
    expect(() =>
      canonicalCaveHpkeRoute(new URL('http://127.0.0.1:3020/a%2Fb')),
    ).toThrowError(/route path/u);
    expect(() =>
      canonicalCaveHpkeRoute(
        new URL(
          `http://127.0.0.1:3020/${'a'.repeat(
            CAVE_HPKE_LIMITS.canonicalRouteBytes,
          )}`,
        ),
      ),
    ).toThrowError(/size limit/u);
    expect(
      caveBase64UrlEncode(new DataView(new Uint8Array([1, 2, 3]).buffer)),
    ).toBe('AQID');

    await expect(
      createCaveHpkeBoundRequest({
        ...request,
        authorization: { kind: 'bearer', value: '' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(
      createCaveHpkeBoundRequest({
        ...request,
        discovered: {
          ...discovered,
          authority: {
            ...discovered.authority,
            mode: 'unsupported',
          },
        } as unknown as CaveDiscoveredEndpointV2,
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(
      createCaveHpkeBoundRequest({
        ...request,
        discovered: {
          ...discovered,
          authority: {
            ...discovered.authority,
            keyId: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(
      createCaveHpkeBoundRequest({
        ...request,
        requestNonce: new Uint8Array(31),
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(
      createCaveHpkeBoundRequest({
        ...request,
        body: new Uint8Array(CAVE_HPKE_LIMITS.requestBodyBytes + 1),
      }),
    ).rejects.toMatchObject({ code: 'body_limit' });
  });

  test('canonicalizes routes and validates strict discovery v2', async () => {
    const { vector } = await loadVector();
    expect(
      canonicalCaveHpkeRoute(
        new URL('http://127.0.0.1:3020/api/client/v1/projects?z=%2A&a=two+words&a=one'),
      ),
    ).toBe('/api/client/v1/projects?a=one&a=two%20words&z=%2A');

    const parsed = parseCaveDiscoveryRecord(
      JSON.stringify({
        version: 2,
        endpoint: 'http://127.0.0.1:3020',
        pid: 4_321,
        nonce: vector.inputs.runtimeNonce,
        startedAt: '2026-08-25T15:42:58.109Z',
        authority: {
          mechanism: 'hpke-bound-v1',
          mode: 'enforce',
          keyId: vector.authority.keyId,
          publicKey: vector.authority.publicKey,
          suite: {
            kemId: 32,
            kdfId: 1,
            aeadId: 2,
          },
        },
      }),
      () => true,
    );
    expect(parsed.version).toBe(2);

    expect(() =>
      parseCaveDiscoveryRecord(
        JSON.stringify({
          version: 2,
          endpoint: 'http://127.0.0.1:3020',
          pid: 4_321,
          nonce: vector.inputs.runtimeNonce,
          startedAt: '2026-08-25T15:42:58.109Z',
          authority: {
            mechanism: 'hpke-bound-v1',
            mode: 'enforce',
            keyId: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            publicKey: vector.authority.publicKey,
            suite: { kemId: 32, kdfId: 1, aeadId: 2 },
          },
        }),
        () => true,
      ),
    ).toThrowError(/key id did not match/u);
  });
});
