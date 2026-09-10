import { createHash } from 'node:crypto';

import * as coven from '@opencoven/coven-client';
import type { OperationContext, OperationOptions } from '@opencoven/sdk-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

const CONTRACT = 'coven.session-policy.v1';
const PROFILE = 'workspace-readonly-no-network.v1';
const NOW = 1_800_000_000_000;
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const invocationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const discovery = {
  contract: CONTRACT,
  enforcement: 'unavailable',
  supportedProfiles: [],
  reason: 'no_verified_enforcement_backend',
};

function envelope() {
  return {
    contract: CONTRACT,
    requestId,
    invocationId,
    profile: PROFILE,
    expiresAtUnixMs: NOW + 30_000,
    launch: {
      projectRoot: '/example/project',
      cwd: '/example/project',
      harness: 'codex',
      familiarId: 'sage',
      launchMode: 'nonInteractive',
      prompt: 'Review the supplied material.',
      title: 'Wand review',
    },
  };
}

function bytes(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function digest(body: Uint8Array | readonly number[]): string {
  return `sha256:${createHash('sha256').update(Buffer.from(body)).digest('hex')}`;
}

function refusal(body: Uint8Array | readonly number[]) {
  return {
    contract: CONTRACT,
    requestId,
    invocationId,
    requestDigest: digest(body),
    decision: 'rejected',
    code: 'enforcement_unavailable',
    admission: 'not_started',
  };
}

// The structural seam lets the first red run assert a missing public API,
// rather than fail module loading before any contract assertion executes.
interface PolicyRequest {
  readonly method: 'GET' | 'POST';
  readonly path: '/api/v1/session-policy' | '/api/v1/sessions/restricted';
  readonly maxResponseBytes: number;
  readonly body?: readonly number[];
}

interface PolicyResponse {
  readonly status: number;
  readonly body: Uint8Array;
}

type Request = (request: PolicyRequest, context: OperationContext) => Promise<PolicyResponse>;
interface PolicyClient {
  discover(options?: OperationOptions): Promise<unknown>;
  launchRestricted(body: Uint8Array, options?: OperationOptions): Promise<unknown>;
}

function client(request: Request, operation?: Omit<OperationOptions, 'signal'>): PolicyClient {
  const factory = (coven as {
    createCovenSessionPolicyClient?: (options: {
      transport: { request: Request };
      operation?: Omit<OperationOptions, 'signal'>;
    }) => PolicyClient;
  }).createCovenSessionPolicyClient;
  expect(factory).toBeTypeOf('function');
  if (factory === undefined) throw new Error('Missing policy client factory');
  return factory({ transport: { request }, ...(operation === undefined ? {} : { operation }) });
}

function reply(status: number, value: unknown): PolicyResponse {
  return { status, body: bytes(value) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('explicit refusal-only session policy', () => {
  test('constructs without I/O and discovers through a fixed separate GET', async () => {
    const request = vi.fn<Request>(() => Promise.resolve(reply(200, discovery)));
    const policy = client(request);
    expect(request).not.toHaveBeenCalled();
    await expect(policy.discover()).resolves.toEqual(discovery);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toEqual({
      method: 'GET',
      path: '/api/v1/session-policy',
      maxResponseBytes: 16_384,
    });
    expect(request.mock.calls[0]?.[1].deadline).toBeTypeOf('number');
  });

  test('freezes exact request bytes once and correlates one HTTP409 refusal', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const input = Buffer.from(` \n${JSON.stringify(envelope(), null, 2)}\n`, 'utf8');
    const original = Buffer.from(input);
    const request = vi.fn<Request>((sent, context) => {
      expect(Object.isFrozen(sent)).toBe(true);
      expect(Object.isFrozen(sent.body)).toBe(true);
      expect(context.signal.aborted).toBe(false);
      expect(sent.body).toEqual(Array.from(original));
      input.fill(0);
      expect(sent.body).toEqual(Array.from(original));
      return Promise.resolve(reply(409, refusal(original)));
    });
    await expect(client(request).launchRestricted(input)).resolves.toEqual(refusal(original));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      method: 'POST',
      path: '/api/v1/sessions/restricted',
      maxResponseBytes: 16_384,
    });
    expect(digest(original)).not.toBe(digest(bytes(envelope())));
  });

  test('snapshots octets without invoking a caller-supplied byte iterator', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const body = bytes(envelope());
    const original = Buffer.from(body);
    const iterator = vi.fn(() => [0][Symbol.iterator]());
    Object.defineProperty(body, Symbol.iterator, { value: iterator });
    const request = vi.fn<Request>((sent) => {
      expect(sent.body).toEqual(Array.from(original));
      return Promise.resolve(reply(409, refusal(original)));
    });
    await expect(client(request).launchRestricted(body)).resolves.toEqual(refusal(original));
    expect(iterator).not.toHaveBeenCalled();
  });

  test('binds sorted-key caller bytes including slash escaping without canonicalizing them', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const body = Buffer.from(String.raw`{"contract":"coven.session-policy.v1","expiresAtUnixMs":1800000030000,"invocationId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","launch":{"cwd":"\/example\/project","familiarId":"sage","harness":"codex","launchMode":"nonInteractive","projectRoot":"\/example\/project","prompt":"Review the supplied material.","title":"Wand review"},"profile":"workspace-readonly-no-network.v1","requestId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}`);
    const requestDigest = 'sha256:35439977dac1a32879f6158297c595baf96c5a15793947c8fc052c674d69c1b6';
    expect(body.byteLength).toBe(424);
    expect(digest(body)).toBe(requestDigest);
    expect(digest(bytes(envelope()))).not.toBe(requestDigest);
    const request = vi.fn<Request>((sent) => {
      expect(Buffer.from(sent.body ?? [])).toEqual(body);
      return Promise.resolve(reply(409, { ...refusal(body), requestDigest }));
    });
    await expect(client(request).launchRestricted(body)).resolves.toEqual({
      ...refusal(body), requestDigest,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('never uses health metadata, legacy transport, discovery, or launch fallback', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const health = vi.fn(() => Promise.resolve({
      ok: true as const,
      apiVersion: coven.COVEN_DAEMON_PROTOCOL,
      covenVersion: '0.1.0',
      capabilities: {
        sessions: true,
        events: true,
        structuredErrors: true as const,
        sessionPolicyContracts: [CONTRACT],
      },
    }));
    const legacy = coven.createCovenClient({ transport: { health } });
    const body = bytes(envelope());
    const request = vi.fn<Request>(() => Promise.resolve(reply(409, refusal(body))));
    await client(request).launchRestricted(body);
    expect(health).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    await expect(legacy.health()).resolves.toEqual({ status: 'ok' });
  });

  test.each([
    ['contract', 'coven.session-policy.v2', 'unsupported_contract'],
    ['enforcement', 'available', 'invalid_response'],
    ['supportedProfiles', [PROFILE], 'unsupported_profile'],
    ['supportedProfiles', ['unknown.v1'], 'unsupported_profile'],
    ['supportedProfiles', [false], 'invalid_response'],
    ['supportedProfiles', {}, 'invalid_response'],
    ['reason', 'verified_backend', 'invalid_response'],
    ['extra', true, 'invalid_response'],
  ])('rejects incompatible discovery %s', async (key, value, code) => {
    const request = vi.fn<Request>(() => Promise.resolve(reply(200, { ...discovery, [key]: value })));
    await expect(client(request).discover()).rejects.toMatchObject({
      code,
      retryable: false,
      delivery: 'unknown',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['contract', 'coven.session-policy.v2'],
    ['requestId', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
    ['invocationId', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
    ['requestDigest', `sha256:${'0'.repeat(64)}`],
    ['decision', 'accepted'],
    ['code', 'ok'],
    ['admission', 'started'],
    ['sessionId', 'fabricated'],
    ['receipt', {}],
    ['effectiveGrant', {}],
    ['requestId', null],
    ['requestDigest', 42],
  ])('rejects uncorrelated or fabricated refusal %s=%s', async (key, value) => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const body = bytes(envelope());
    const request = vi.fn<Request>(() =>
      Promise.resolve(reply(409, { ...refusal(body), [key]: value })));
    await expect(client(request).launchRestricted(body)).rejects.toMatchObject({
      delivery: 'unknown',
      retryable: false,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  test.each(Object.keys(refusal(bytes(envelope()))))('requires response field %s', async (key) => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const body = bytes(envelope());
    const partial: Record<string, unknown> = refusal(body);
    delete partial[key];
    await expect(client(() => Promise.resolve(reply(409, partial))).launchRestricted(body))
      .rejects.toMatchObject({ code: 'invalid_response', delivery: 'unknown' });
  });

  test.each([
    ['contract', null], ['enforcement', false],
    ['supportedProfiles', null], ['reason', 42],
  ])('requires discovery field type %s', async (key, value) => {
    await expect(client(() => Promise.resolve(reply(200, { ...discovery, [key]: value }))).discover())
      .rejects.toMatchObject({ code: 'invalid_response', delivery: 'unknown' });
  });

  test('rejects a semantic-reserialization digest for differently spaced bytes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const body = Buffer.from(JSON.stringify(envelope(), null, 2));
    await expect(client(() => Promise.resolve(reply(409, refusal(bytes(envelope()))))).launchRestricted(body))
      .rejects.toMatchObject({ code: 'invalid_response', delivery: 'unknown' });
  });

  test('rejects duplicate-key and invalid-Unicode refusal bodies before interpreting the decision', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const body = bytes(envelope());
    for (const response of [
      JSON.stringify(refusal(body)).replace('"decision":', '"decision":"accepted","decision":'),
      JSON.stringify(refusal(body)).replace('"decision":', '"deci\\u0073ion":"rejected","decision":'),
      JSON.stringify(refusal(body)).replace('"rejected"', '"\\ud800"'),
    ]) {
      const request = vi.fn<Request>(() => Promise.resolve({ status: 409, body: Buffer.from(response) }));
      await expect(client(request).launchRestricted(body))
        .rejects.toMatchObject({ code: 'invalid_response', delivery: 'unknown' });
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  test.each([200, 201, 202, 204, 301, 400, 403, 404, 405, 500, 501])(
    'does not interpret HTTP%s as not_started or retry it',
    async (status) => {
      vi.spyOn(Date, 'now').mockReturnValue(NOW);
      const body = bytes(envelope());
      const request = vi.fn<Request>(() => Promise.resolve(reply(status, refusal(body))));
      await expect(client(request).launchRestricted(body)).rejects.toMatchObject({
        delivery: 'unknown',
        retryable: false,
        statusCode: status,
      });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    [400, 'invalid_request'], [403, 'forbidden'],
    [409, 'session_policy_expired'], [500, 'internal_error'],
  ] as const)('reports structured HTTP%s %s without a refusal claim', async (status, code) => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const request = vi.fn<Request>(() => Promise.resolve(reply(status, {
      error: { code, message: 'sensitive server message', status },
    })));
    const error = await client(request).launchRestricted(bytes(envelope())).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'http_error', statusCode: status, delivery: 'unknown', retryable: false });
    expect(error).not.toHaveProperty('admission');
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain('sensitive');
    expect(request).toHaveBeenCalledTimes(1);
  });

  const malformed = [
    'null', '[]', '"object"', '{', '{}{}',
    '{"contract":"coven.session-policy.v1","contract":"coven.session-policy.v1"}',
    '{"contract":"coven.session-policy.v1","contr\\u0061ct":"coven.session-policy.v1"}',
    '{"nested":{"x":1,"x":2}}',
    '{"nested":"\\ud800"}', '{"nested":"\\udc00"}',
    '{"nested":[[[[[[[[[[[[[[[[[0]]]]]]]]]]]]]]]]]}',
    '{"nested":NaN}', '{"nested":1e999}', '\ufeff{}',
  ];

  test.each(malformed)('rejects malformed raw response %s', async (text) => {
    const request = vi.fn<Request>(() => Promise.resolve({ status: 200, body: Buffer.from(text) }));
    await expect(client(request).discover()).rejects.toMatchObject({ code: 'invalid_response' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  test.each([
    Buffer.from([0xc0, 0x80]),
    Buffer.from([0xed, 0xa0, 0x80]),
    Buffer.alloc(16_385, 0x20),
  ])('rejects invalid UTF8 or oversized raw response %#', async (body) => {
    await expect(client(() => Promise.resolve({ status: 200, body })).discover())
      .rejects.toMatchObject({ code: 'invalid_response' });
  });

  test.each([
    ['contract', 'unknown.v1', 'unsupported_contract'],
    ['profile', 'unknown.v1', 'unsupported_profile'],
    ['requestId', requestId.toUpperCase(), 'invalid_request'],
    ['invocationId', 'bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb', 'invalid_request'],
    ['expiresAtUnixMs', NOW, 'invalid_request'],
    ['expiresAtUnixMs', NOW + 300_001, 'invalid_request'],
    ['expiresAtUnixMs', NOW + 0.5, 'invalid_request'],
    ['expiresAtUnixMs', Number.MAX_SAFE_INTEGER + 1, 'invalid_request'],
    ['extra', true, 'invalid_request'],
  ])('rejects invalid request %s locally', async (key, value, code) => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const request = vi.fn<Request>();
    await expect(client(request).launchRestricted(bytes({ ...envelope(), [key]: value })))
      .rejects.toMatchObject({ code, delivery: 'not_attempted', retryable: false });
    expect(request).not.toHaveBeenCalled();
  });

  test.each(['1800000030000.0', '1.80000003e12', '18000000300000e-1'])(
    'rejects non-integer wire encoding %s even when its numeric value is an integer',
    async (encoding) => {
      vi.spyOn(Date, 'now').mockReturnValue(NOW);
      const body = Buffer.from(JSON.stringify(envelope()).replace('1800000030000', encoding));
      const request = vi.fn<Request>(() => Promise.resolve(reply(409, refusal(body))));
      await expect(client(request).launchRestricted(body))
        .rejects.toMatchObject({ code: 'invalid_request', delivery: 'not_attempted' });
      expect(request).not.toHaveBeenCalled();
    },
  );

  test.each([
    ['projectRoot', ''],
    ['cwd', 'x'.repeat(4097)],
    ['harness', 'x'.repeat(129)],
    ['familiarId', ' sage '],
    ['familiarId', 'x'.repeat(129)],
    ['launchMode', 'interactive'],
    ['prompt', '\ud800'],
    ['prompt', 'a\0b'],
    ['prompt', 'x'.repeat(1_000_001)],
    ['title', '\u00e9'.repeat(257)],
    ['extra', true],
  ])('rejects invalid launch %s without authority/path I/O', async (key, value) => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const request = vi.fn<Request>();
    const input = envelope();
    await expect(client(request).launchRestricted(bytes({
      ...input, launch: { ...input.launch, [key]: value },
    }))).rejects.toMatchObject({ code: 'invalid_request', delivery: 'not_attempted' });
    expect(request).not.toHaveBeenCalled();
  });

  test.each(malformed)('rejects malformed raw request %s before transport', async (text) => {
    const request = vi.fn<Request>();
    await expect(client(request).launchRestricted(Buffer.from(text)))
      .rejects.toMatchObject({ code: 'invalid_request', delivery: 'not_attempted' });
    expect(request).not.toHaveBeenCalled();
  });

  test('rejects oversized request bytes before parsing or transport', async () => {
    const request = vi.fn<Request>();
    await expect(client(request).launchRestricted(Buffer.alloc(1_048_577)))
      .rejects.toMatchObject({ code: 'invalid_request', delivery: 'not_attempted' });
    expect(request).not.toHaveBeenCalled();
  });

  test('accepts exactly the wire byte limits without changing the transmitted digest', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const compact = bytes(envelope());
    const body = Buffer.concat([compact, Buffer.alloc(1_048_576 - compact.length, 0x20)]);
    const result = refusal(body);
    const compactResponse = bytes(result);
    const responseBody = Buffer.concat([
      compactResponse, Buffer.alloc(16_384 - compactResponse.length, 0x20),
    ]);
    const request = vi.fn<Request>((sent) => {
      expect(sent.body?.length).toBe(1_048_576);
      expect(digest(sent.body ?? [])).toBe(result.requestDigest);
      return Promise.resolve({ status: 409, body: responseBody });
    });
    await expect(client(request).launchRestricted(body)).resolves.toEqual(result);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('accepts empty title and opaque paths without resolving them', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const input = envelope();
    input.launch.title = '';
    input.launch.cwd = '/nonexistent/../opaque';
    input.launch.prompt = '\u00e9 \ud83d\udc08';
    input.expiresAtUnixMs = NOW + 300_000;
    const body = bytes(input);
    await expect(client(() => Promise.resolve(reply(409, refusal(body)))).launchRestricted(body))
      .resolves.toEqual(refusal(body));
  });

  test('rejects harness IDs outside the clarified canonical v1 wire set before transport', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const input = envelope();
    input.launch.harness = 'unknown-harness';
    const request = vi.fn<Request>(() => Promise.resolve(reply(400, {
      error: { code: 'VALIDATION_ERROR', message: 'Unsupported harness', status: 400 },
    })));
    await expect(client(request).launchRestricted(bytes(input)))
      .rejects.toMatchObject({ code: 'invalid_request', delivery: 'not_attempted', retryable: false });
    expect(request).not.toHaveBeenCalled();
  });

  test.each(['codex', 'claude', 'coven-code', 'copilot'])(
    'accepts canonical harness ID %s only for refusal correlation, not approval',
    async (harness) => {
      vi.spyOn(Date, 'now').mockReturnValue(NOW);
      const input = envelope();
      input.launch.harness = harness;
      const body = bytes(input);
      const request = vi.fn<Request>(() => Promise.resolve(reply(409, refusal(body))));
      await expect(client(request).launchRestricted(body)).resolves.toEqual(refusal(body));
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  test('cancellation before transport is not_attempted without retaining the sensitive reason', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const controller = new AbortController();
    controller.abort(new Error('secret abort reason'));
    const request = vi.fn<Request>();
    const error = await client(request).launchRestricted(bytes(envelope()), { signal: controller.signal })
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'aborted', delivery: 'not_attempted', retryable: false });
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain('secret');
    expect(request).not.toHaveBeenCalled();
  });

  test('cancellation after dispatch cannot be converted to a late correlated refusal', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const controller = new AbortController();
    const body = bytes(envelope());
    let context: OperationContext | undefined;
    const request = vi.fn<Request>((_request, current) => {
      context = current;
      controller.abort(new Error('secret'));
      return Promise.resolve(reply(409, refusal(body)));
    });
    await expect(client(request).launchRestricted(body, { signal: controller.signal }))
      .rejects.toMatchObject({ code: 'aborted', delivery: 'unknown', retryable: false });
    expect(context?.signal.aborted).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('times out a non-cooperative transport with one attempt and sanitized observer metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const onEvent = vi.fn();
    const observer = { onEvent, onObserverError: vi.fn() };
    let context: OperationContext | undefined;
    const request = vi.fn<Request>((_request, current) => {
      context = current;
      return new Promise(() => undefined);
    });
    const result = client(request, { timeoutMs: 20, observer }).launchRestricted(bytes(envelope()));
    const assertion = expect(result).rejects.toMatchObject({
      code: 'timeout', delivery: 'unknown', retryable: false,
      normalized: { system: 'coven', operation: 'sessionPolicy.launchRestricted' },
    });
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
    expect(context?.signal.aborted).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls.map((call) => (call[0] as { phase: string }).phase)).toEqual(['start', 'timeout']);
    expect(onEvent.mock.calls[1]?.[0]).toMatchObject({ error: { retryable: false } });
    expect(JSON.stringify(onEvent.mock.calls)).not.toContain('supplied material');
    expect(vi.getTimerCount()).toBe(0);
  });

  test('bounds the operation by the request admission deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const input = envelope();
    input.expiresAtUnixMs = NOW + 10;
    const request = vi.fn<Request>(() => new Promise(() => undefined));
    const result = client(request, { timeoutMs: 1000 }).launchRestricted(bytes(input));
    const assertion = expect(result).rejects.toMatchObject({ code: 'timeout', delivery: 'unknown' });
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('discovery uses the bounded default timeout without retries', async () => {
    vi.useFakeTimers();
    const request = vi.fn<Request>(() => new Promise(() => undefined));
    const result = client(request).discover();
    const assertion = expect(result).rejects.toMatchObject({ code: 'timeout', delivery: 'unknown', retryable: false });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('a late valid refusal after deadline expiry remains uncertain', async () => {
    let now = NOW;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const body = bytes(envelope());
    const request = vi.fn<Request>(() => {
      now = NOW + 30_000;
      return Promise.resolve(reply(409, refusal(body)));
    });
    await expect(client(request).launchRestricted(body))
      .rejects.toMatchObject({ code: 'timeout', delivery: 'unknown' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('rechecks the deadline after observer work before dispatch', async () => {
    let now = NOW;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const request = vi.fn<Request>();
    const observer = { onEvent: () => { now = NOW + 30_000; }, onObserverError: vi.fn() };
    await expect(client(request).launchRestricted(bytes(envelope()), { observer }))
      .rejects.toMatchObject({ code: 'timeout', delivery: 'not_attempted' });
    expect(request).not.toHaveBeenCalled();
  });

  test('counts bounded request preparation against the caller timeout', async () => {
    let monotonic = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
    vi.spyOn(Date, 'now').mockImplementation(() => {
      monotonic = 10;
      return NOW;
    });
    const request = vi.fn<Request>(() => Promise.resolve(reply(409, refusal(bytes(envelope())))));
    await expect(client(request).launchRestricted(bytes(envelope()), { timeoutMs: 5 }))
      .rejects.toMatchObject({ code: 'timeout', delivery: 'not_attempted' });
    expect(request).not.toHaveBeenCalled();
  });

  test('rejects invalid operation options without a request', async () => {
    const request = vi.fn<Request>();
    await expect(client(request).discover({ timeoutMs: 0 }))
      .rejects.toMatchObject({ code: 'invalid_options', delivery: 'not_attempted' });
    expect(request).not.toHaveBeenCalled();
  });

  test('transport failure is uncertain, not retryable, and does not leak raw errors', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const sensitive = Object.assign(new Error('secret'), {
      code: 'secret code', requestId: 'secret id', retryable: true,
    });
    const request = vi.fn<Request>(() => Promise.reject(sensitive));
    const error = await client(request).launchRestricted(bytes(envelope())).catch((error: unknown) => error);
    expect(error).toMatchObject({
      code: 'transport_error', delivery: 'unknown', retryable: false,
      requestId, invocationId, requestDigest: digest(bytes(envelope())),
    });
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain('secret');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
