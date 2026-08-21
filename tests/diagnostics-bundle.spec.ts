import {
  DIAGNOSTICS_SCHEMA,
  REDACTED_HOST,
  createDiagnosticsBundle,
  sanitizeDiagnosticsError,
  summarizeDiagnosticsEndpoint,
  summarizeOperationEvents,
  type DiagnosticsEndpointInput,
  type DiagnosticsInput,
  type NormalizedError,
  type OperationEvent,
} from '@opencoven/sdk-core';
import { describe, expect, test } from 'vitest';

/** Values that must never survive into a bundle, whatever slot they arrive in. */
const SECRETS = [
  'sk-live-not-a-real-key',
  'Bearer hunter2',
  'Summarize the attached contract',
  'invoice-2026.pdf',
  'internal.example.invalid',
];

function poisonedInput(): DiagnosticsInput {
  return {
    packages: {
      '@opencoven/sdk-core': '0.1.0',
      // A version that is really a credential does not match the version shape.
      '@opencoven/leaky': 'sk-live-not-a-real-key',
      'Invalid Name': '0.1.0',
    },
    runtime: {
      node: 'v24.18.0',
      platform: 'linux',
      arch: 'x64',
      authorization: 'Bearer hunter2',
    },
    capabilities: {
      cave: { health: true, prompt: 'Summarize the attached contract' },
      mystery: { health: true },
    },
    discovery: [{ label: 'cave', url: 'https://user:hunter2@internal.example.invalid/v1?token=abc' }],
    events: [
      {
        phase: 'failure',
        system: 'cave',
        operation: 'health',
        durationMs: 12,
        error: {
          system: 'cave',
          code: 'unauthorized',
          retryable: false,
          operation: 'health',
          message: 'Bearer hunter2 was rejected',
        },
        prompt: 'Summarize the attached contract',
        attachments: ['invoice-2026.pdf'],
      },
    ],
    errors: [
      {
        system: 'cave',
        code: 'unauthorized',
        retryable: false,
        operation: 'health',
        message: 'Bearer hunter2 was rejected',
        requestId: 'req-9',
        statusCode: 401,
      },
    ],
  } as unknown as DiagnosticsInput;
}

describe('diagnostics bundles', () => {
  test('carries no prompt, token, attachment, or event payload from any slot', () => {
    const serialized = JSON.stringify(createDiagnosticsBundle(poisonedInput()));

    for (const secret of SECRETS) {
      expect(serialized).not.toContain(secret);
    }

    for (const key of ['prompt', 'attachments', 'authorization', 'message', 'token']) {
      expect(serialized).not.toContain(key);
    }
  });

  test('keeps exactly the allowlisted fields from a poisoned input', () => {
    expect(createDiagnosticsBundle(poisonedInput())).toEqual({
      schema: DIAGNOSTICS_SCHEMA,
      versions: {
        packages: { '@opencoven/sdk-core': '0.1.0' },
        runtime: { node: 'v24.18.0', platform: 'linux', arch: 'x64' },
      },
      capabilities: {
        cave: { health: true },
      },
      discovery: [
        {
          label: 'cave',
          protocol: 'https',
          host: REDACTED_HOST,
          port: null,
          loopback: false,
          credentialsInUrl: true,
          query: true,
        },
      ],
      operations: [
        {
          system: 'cave',
          operation: 'health',
          started: 0,
          succeeded: 0,
          failed: 1,
          timedOut: 0,
          aborted: 0,
          maxDurationMs: 12,
          codes: ['unauthorized'],
        },
      ],
      errors: [
        {
          system: 'cave',
          operation: 'health',
          code: 'unauthorized',
          retryable: false,
          requestId: 'req-9',
          statusCode: 401,
        },
      ],
    });
  });

  test('returns an empty bundle for absent, empty, and non-object input', () => {
    const empty = {
      schema: DIAGNOSTICS_SCHEMA,
      versions: { packages: {}, runtime: {} },
      capabilities: {},
      discovery: [],
      operations: [],
      errors: [],
    };

    expect(createDiagnosticsBundle()).toEqual(empty);
    expect(createDiagnosticsBundle({})).toEqual(empty);
    expect(createDiagnosticsBundle(null as unknown as DiagnosticsInput)).toEqual(empty);
    expect(
      createDiagnosticsBundle({
        packages: 'nope',
        runtime: 7,
        capabilities: [],
        discovery: 'nope',
        events: 'nope',
        errors: 'nope',
      } as unknown as DiagnosticsInput),
    ).toEqual(empty);
  });

  test('sorts packages and capability operations so two bundles are comparable', () => {
    const bundle = createDiagnosticsBundle({
      packages: { '@opencoven/sdk': '0.1.0', '@opencoven/cave-client': '0.1.0' },
      capabilities: { cave: { health: true, familiars: false } },
    });

    expect(Object.keys(bundle.versions.packages)).toEqual([
      '@opencoven/cave-client',
      '@opencoven/sdk',
    ]);
    expect(Object.keys(bundle.capabilities.cave ?? {})).toEqual(['familiars', 'health']);
  });

  test('drops a capability group that survives sanitization empty', () => {
    expect(
      createDiagnosticsBundle({
        capabilities: { cave: { health: 'yes' }, coven: { health: true } },
      } as unknown as DiagnosticsInput).capabilities,
    ).toEqual({ coven: { health: true } });
  });
});

describe('endpoint summaries', () => {
  test('keeps a loopback host and redacts every other one', () => {
    expect(summarizeDiagnosticsEndpoint({ label: 'cave', url: 'http://127.0.0.1:4000/api' })).toEqual({
      label: 'cave',
      protocol: 'http',
      host: '127.0.0.1',
      port: 4000,
      loopback: true,
      credentialsInUrl: false,
      query: false,
    });

    expect(
      summarizeDiagnosticsEndpoint({ label: 'coven', url: 'https://coven.example.invalid/' })?.host,
    ).toBe(REDACTED_HOST);
    expect(summarizeDiagnosticsEndpoint({ label: 'ipv6', url: 'http://[::1]:7000/' })?.host).toBe(
      '[::1]',
    );
    expect(summarizeDiagnosticsEndpoint({ label: 'named', url: 'http://LOCALHOST/' })?.host).toBe(
      'localhost',
    );
  });

  test('reports a URL credential as a boolean rather than repeating it', () => {
    const summary = summarizeDiagnosticsEndpoint({
      label: 'cave',
      url: 'https://token:secret@127.0.0.1/api?key=secret',
    });

    expect(summary?.credentialsInUrl).toBe(true);
    expect(summary?.query).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('secret');
  });

  test('omits an endpoint it cannot read rather than half-reporting it', () => {
    expect(summarizeDiagnosticsEndpoint({ label: 'cave', url: 'not a url' })).toBeUndefined();
    expect(summarizeDiagnosticsEndpoint({ label: '', url: 'http://127.0.0.1/' })).toBeUndefined();
    expect(
      summarizeDiagnosticsEndpoint({ label: 'a/b', url: 'http://127.0.0.1/' }),
    ).toBeUndefined();
    expect(
      summarizeDiagnosticsEndpoint({ label: 'cave', url: 7 } as unknown as DiagnosticsEndpointInput),
    ).toBeUndefined();
    expect(
      summarizeDiagnosticsEndpoint(null as unknown as DiagnosticsEndpointInput),
    ).toBeUndefined();
  });
});

describe('error summaries', () => {
  test('drops the message and keeps validated scalar metadata', () => {
    expect(
      sanitizeDiagnosticsError({
        system: 'coven',
        code: 'unavailable',
        retryable: true,
        operation: 'health',
        message: 'Coven health request failed',
        requestId: 'req-1',
        statusCode: 503,
      }),
    ).toEqual({
      system: 'coven',
      operation: 'health',
      code: 'unavailable',
      retryable: true,
      requestId: 'req-1',
      statusCode: 503,
    });
  });

  test('rejects an unusable system, operation, or code', () => {
    const base = { system: 'cave', code: 'unauthorized', retryable: false, operation: 'health' };

    expect(sanitizeDiagnosticsError({ ...base, system: 'mystery' } as unknown as NormalizedError)).toBeUndefined();
    expect(sanitizeDiagnosticsError({ ...base, operation: '' } as unknown as NormalizedError)).toBeUndefined();
    expect(sanitizeDiagnosticsError({ ...base, code: '  ' } as unknown as NormalizedError)).toBeUndefined();
    expect(sanitizeDiagnosticsError(undefined as unknown as NormalizedError)).toBeUndefined();
  });

  test('drops metadata that fails its shape check', () => {
    expect(
      sanitizeDiagnosticsError({
        system: 'cave',
        code: 'unauthorized',
        retryable: false,
        operation: 'health',
        requestId: 'req 1 with spaces',
        statusCode: 99,
      }),
    ).toEqual({
      system: 'cave',
      operation: 'health',
      code: 'unauthorized',
      retryable: false,
    });
  });
});

describe('operation summaries', () => {
  const events: OperationEvent[] = [
    { phase: 'start', system: 'coven', operation: 'health' },
    { phase: 'start', system: 'cave', operation: 'health' },
    { phase: 'success', system: 'cave', operation: 'health', durationMs: 4.4 },
    {
      phase: 'timeout',
      system: 'cave',
      operation: 'health',
      durationMs: 90.6,
      error: { system: 'cave', code: 'timeout', retryable: true, operation: 'health' },
    },
    {
      phase: 'abort',
      system: 'cave',
      operation: 'health',
      durationMs: 2,
      error: { system: 'cave', code: 'aborted', retryable: false, operation: 'health' },
    },
    {
      phase: 'failure',
      system: 'coven',
      operation: 'health',
      durationMs: 3,
      error: { system: 'coven', code: 'unavailable', retryable: true, operation: 'health' },
    },
  ];

  test('counts phases, keeps the slowest duration, and collects normalized codes', () => {
    expect(summarizeOperationEvents(events)).toEqual([
      {
        system: 'cave',
        operation: 'health',
        started: 1,
        succeeded: 1,
        failed: 0,
        timedOut: 1,
        aborted: 1,
        maxDurationMs: 91,
        codes: ['aborted', 'timeout'],
      },
      {
        system: 'coven',
        operation: 'health',
        started: 1,
        succeeded: 0,
        failed: 1,
        timedOut: 0,
        aborted: 0,
        maxDurationMs: 3,
        codes: ['unavailable'],
      },
    ]);
  });

  test('ignores an event it cannot attribute to a system and operation', () => {
    expect(
      summarizeOperationEvents([
        { phase: 'start', system: 'mystery', operation: 'health' },
        { phase: 'start', system: 'cave', operation: '' },
        null,
      ] as unknown as OperationEvent[]),
    ).toEqual([]);
  });

  test('keeps counting when a terminal event arrives without its error', () => {
    expect(
      summarizeOperationEvents([
        { phase: 'failure', system: 'cave', operation: 'health', durationMs: 7 },
        {
          phase: 'failure',
          system: 'cave',
          operation: 'health',
          durationMs: 8,
          error: { system: 'cave', code: 'unavailable', retryable: true, operation: 'health' },
        },
      ] as unknown as OperationEvent[]),
    ).toEqual([
      {
        system: 'cave',
        operation: 'health',
        started: 0,
        succeeded: 0,
        failed: 2,
        timedOut: 0,
        aborted: 0,
        maxDurationMs: 8,
        codes: ['unavailable'],
      },
    ]);
  });

  test('survives a malformed event rather than losing the whole bundle', () => {
    expect(
      createDiagnosticsBundle({
        packages: { '@opencoven/sdk-core': '0.1.0' },
        events: [{ phase: 'timeout', system: 'cave', operation: 'health', durationMs: 3 }],
      } as unknown as DiagnosticsInput).versions.packages,
    ).toEqual({ '@opencoven/sdk-core': '0.1.0' });
  });

  test('drops a phase it does not recognize instead of calling it an abort', () => {
    expect(
      summarizeOperationEvents([
        {
          phase: 'cancelled',
          system: 'cave',
          operation: 'health',
          durationMs: 400,
          error: { system: 'cave', code: 'aborted', retryable: false, operation: 'health' },
        },
        { phase: 'start', system: 'cave', operation: 'health' },
      ] as unknown as OperationEvent[]),
    ).toEqual([
      {
        system: 'cave',
        operation: 'health',
        started: 1,
        succeeded: 0,
        failed: 0,
        timedOut: 0,
        aborted: 0,
        maxDurationMs: null,
        codes: [],
      },
    ]);
  });

  test('leaves the slowest duration unset when no event reported one', () => {
    expect(
      summarizeOperationEvents([
        { phase: 'start', system: 'cli', operation: 'diagnostics' },
        {
          phase: 'success',
          system: 'cli',
          operation: 'diagnostics',
          durationMs: Number.NaN,
        },
      ] as unknown as OperationEvent[]),
    ).toEqual([
      {
        system: 'cli',
        operation: 'diagnostics',
        started: 1,
        succeeded: 1,
        failed: 0,
        timedOut: 0,
        aborted: 0,
        maxDurationMs: null,
        codes: [],
      },
    ]);
  });
});
