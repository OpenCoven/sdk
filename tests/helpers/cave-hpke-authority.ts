import { createHash, randomBytes } from 'node:crypto';

import {
  Aes256Gcm,
  CipherSuite,
  HkdfSha256,
} from '@hpke/core';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import canonicalize from 'canonicalize';

import {
  CAVE_HPKE_HEADERS,
  CAVE_HPKE_REQUEST_INFO,
  CAVE_HPKE_RESPONSE_INFO,
  CAVE_HPKE_RESPONSE_MEDIA_TYPE,
  canonicalCaveHpkeRoute,
  caveHpkeBase64UrlDecode,
  caveHpkeBase64UrlEncode,
  encodeCaveHpkeAad,
  type CaveHpkeAuthorization,
  type CaveHpkeBinding,
} from '../../packages/cave/src/hpke-bound-v1-node.js';
import type { CaveDiscoveredEndpointV2 } from '../../packages/cave/src/discovery.js';

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder('utf-8', { fatal: true });
const INSTANCE_ID = '00000000-0000-4000-8000-000000000000';

function suite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
}

function exactObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Malformed test HPKE request.');
  }
  return value as Record<string, unknown>;
}

export interface OpenedTestRequest {
  authorization: CaveHpkeAuthorization;
  binding: CaveHpkeBinding;
  responsePublicKey: Awaited<
    ReturnType<CipherSuite['kem']['deserializePublicKey']>
  >;
  responsePublicKeyEncoded: string;
}

export interface TestHpkeAuthority {
  discovered: CaveDiscoveredEndpointV2;
  instanceId: string;
  open(request: Request): Promise<OpenedTestRequest>;
  respond(
    opened: OpenedTestRequest,
    status: number,
    payload: unknown,
    options?: { retryAfter?: string },
  ): Promise<Response>;
}

export async function createTestHpkeAuthority(
  endpoint = 'http://127.0.0.1:3020',
  mode: 'advertise' | 'enforce' = 'advertise',
): Promise<TestHpkeAuthority> {
  const hpke = suite();
  const recipient = await hpke.kem.generateKeyPair();
  const publicKey = new Uint8Array(
    await hpke.kem.serializePublicKey(recipient.publicKey),
  );
  const keyId = new Uint8Array(
    createHash('sha256')
      .update('OpenCoven/client-v1/hpke-bound-v1/key-id\0', 'utf8')
      .update(publicKey)
      .digest(),
  );
  const runtimeNonce = new Uint8Array(randomBytes(32));
  const discovered: CaveDiscoveredEndpointV2 = Object.freeze({
    version: 2,
    endpoint: Object.freeze({ kind: 'http', url: endpoint }),
    freshness: Object.freeze({
      pid: 4_321,
      nonce: caveHpkeBase64UrlEncode(runtimeNonce),
      startedAt: '2026-08-25T15:42:58.109Z',
    }),
    authority: Object.freeze({
      mechanism: 'hpke-bound-v1',
      mode,
      keyId: caveHpkeBase64UrlEncode(keyId),
      publicKey: caveHpkeBase64UrlEncode(publicKey),
      suite: Object.freeze({
        kemId: 32,
        kdfId: 1,
        aeadId: 2,
      }),
    }),
    record: Object.freeze({
      path: '/owner-checked/client-v1-discovery.json',
      device: 7,
      inode: 11,
    }),
  });

  return {
    discovered,
    instanceId: INSTANCE_ID,
    async open(request) {
      const headers = request.headers;
      if (
        headers.get('authorization') !== null ||
        headers.get('x-coven-pairing-secret') !== null
      ) {
        throw new Error('Protected request exposed plaintext credentials.');
      }
      if (headers.get(CAVE_HPKE_HEADERS.mechanism) !== 'hpke-bound-v1') {
        throw new Error('Protected request was not HPKE-bound.');
      }
      const keyIdEncoded = headers.get(CAVE_HPKE_HEADERS.keyId);
      const runtimeNonceEncoded = headers.get(CAVE_HPKE_HEADERS.runtimeNonce);
      const requestNonce = headers.get(CAVE_HPKE_HEADERS.requestNonce);
      const instanceIdEncoded = headers.get(CAVE_HPKE_HEADERS.instanceId);
      const issuedAtEncoded = headers.get(CAVE_HPKE_HEADERS.issuedAt);
      const encEncoded = headers.get(CAVE_HPKE_HEADERS.enc);
      const ciphertextEncoded = headers.get(CAVE_HPKE_HEADERS.ciphertext);
      if (
        keyIdEncoded !== discovered.authority.keyId ||
        runtimeNonceEncoded !== discovered.freshness.nonce ||
        requestNonce === null ||
        instanceIdEncoded === null ||
        issuedAtEncoded === null ||
        encEncoded === null ||
        ciphertextEncoded === null
      ) {
        throw new Error('Protected request binding was incomplete.');
      }
      const instanceId = UTF8_FATAL.decode(
        caveHpkeBase64UrlDecode(instanceIdEncoded, {
          minimum: 1,
          maximum: 256,
        }),
      );
      if (instanceId !== INSTANCE_ID) {
        throw new Error('Protected request used the wrong instance.');
      }
      const body = new Uint8Array(await request.arrayBuffer());
      const binding: CaveHpkeBinding = {
        method: request.method,
        route: canonicalCaveHpkeRoute(new URL(request.url)),
        bodySha256: new Uint8Array(
          createHash('sha256').update(body).digest(),
        ),
        instanceId,
        runtimeNonce: runtimeNonceEncoded,
        runtimeNonceBytes: caveHpkeBase64UrlDecode(runtimeNonceEncoded, {
          minimum: 32,
          maximum: 32,
        }),
        keyId: keyIdEncoded,
        keyIdBytes: caveHpkeBase64UrlDecode(keyIdEncoded, {
          minimum: 32,
          maximum: 32,
        }),
        requestNonce,
        requestNonceBytes: caveHpkeBase64UrlDecode(requestNonce, {
          minimum: 32,
          maximum: 32,
        }),
        issuedAt: Number(issuedAtEncoded),
      };
      const recipientContext = await hpke.createRecipientContext({
        recipientKey: recipient.privateKey,
        enc: caveHpkeBase64UrlDecode(encEncoded, {
          minimum: 32,
          maximum: 32,
        }),
        info: CAVE_HPKE_REQUEST_INFO,
      });
      const plaintext = new Uint8Array(
        await recipientContext.open(
          caveHpkeBase64UrlDecode(ciphertextEncoded, {
            minimum: 16,
            maximum: 2_048,
          }),
          encodeCaveHpkeAad('request', binding),
        ),
      );
      const value = exactObject(JSON.parse(UTF8_FATAL.decode(plaintext)));
      const authorization = exactObject(value.authorization);
      if (
        value.version !== 1 ||
        typeof value.responsePublicKey !== 'string' ||
        (authorization.kind !== 'pairing-secret' &&
          authorization.kind !== 'bearer') ||
        typeof authorization.value !== 'string'
      ) {
        throw new Error('Protected request plaintext was malformed.');
      }
      const responsePublicKey = await hpke.kem.deserializePublicKey(
        caveHpkeBase64UrlDecode(value.responsePublicKey, {
          minimum: 32,
          maximum: 32,
        }),
      );
      return {
        authorization: {
          kind: authorization.kind,
          value: authorization.value,
        },
        binding,
        responsePublicKey,
        responsePublicKeyEncoded: value.responsePublicKey,
      };
    },
    async respond(opened, status, payload, options = {}) {
      const body = UTF8.encode(JSON.stringify(payload));
      const plaintext = canonicalize({
        body: caveHpkeBase64UrlEncode(body),
        headers: {
          contentType: 'application/json',
          ...(options.retryAfter === undefined
            ? {}
            : { retryAfter: options.retryAfter }),
        },
        requestNonce: opened.binding.requestNonce,
        status,
        version: 1,
      });
      if (typeof plaintext !== 'string') {
        throw new Error('Test response was not canonical JSON.');
      }
      const sender = await hpke.createSenderContext({
        recipientPublicKey: opened.responsePublicKey,
        senderKey: recipient.privateKey,
        info: CAVE_HPKE_RESPONSE_INFO,
      });
      const ciphertext = await sender.seal(
        UTF8.encode(plaintext),
        encodeCaveHpkeAad('response', opened.binding),
      );
      return Response.json(
        {
          version: 1,
          mechanism: 'hpke-bound-v1',
          keyId: opened.binding.keyId,
          requestNonce: opened.binding.requestNonce,
          enc: caveHpkeBase64UrlEncode(sender.enc),
          ciphertext: caveHpkeBase64UrlEncode(ciphertext),
        },
        {
          status: 200,
          headers: {
            'content-type': CAVE_HPKE_RESPONSE_MEDIA_TYPE,
          },
        },
      );
    },
  };
}
