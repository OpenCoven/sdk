import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

import type { CaveHealthResponse } from './schemas.js';
import type { CaveTransport } from './transport.js';

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

export type CaveFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface CaveHttpTransportOptions {
  fetch?: CaveFetch;
  maxBodyBytes?: number;
}

export function resolveCaveHttpMaxBodyBytes(
  options: CaveHttpTransportOptions = {},
): number {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new RangeError('maxBodyBytes must be a positive safe integer');
  }
  return maxBodyBytes;
}

class CaveHttpTransportError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: 'body_limit' | 'http_status' | 'invalid_response',
    message: string,
    readonly statusCode?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CaveHttpTransportError';
    this.retryable =
      code === 'http_status' &&
      statusCode !== undefined &&
      (statusCode === 408 || statusCode === 429 || statusCode >= 500);
  }
}

function bodyLimit(
  maxBodyBytes: number,
  options?: ErrorOptions,
): CaveHttpTransportError {
  return new CaveHttpTransportError(
    'body_limit',
    `Cave Client v1 response exceeded the ${maxBodyBytes}-byte limit.`,
    undefined,
    options,
  );
}

async function readBoundedBody(
  response: Response,
  maxBodyBytes: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const responseBody =
    response.body as NodeReadableStream<Uint8Array> | null;
  if (responseBody === null) {
    return new Uint8Array();
  }

  const reader = responseBody.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let cancellation: Promise<void> | undefined;
  const onAbort = (): void => {
    cancellation ??= reader.cancel(signal?.reason);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted === true) {
    onAbort();
  }

  try {
    signal?.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) {
        break;
      }

      if (value.byteLength > maxBodyBytes - totalBytes) {
        try {
          await reader.cancel();
        } catch (error) {
          throw bodyLimit(maxBodyBytes, { cause: error });
        }
        throw bodyLimit(maxBodyBytes);
      }

      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try {
      if (cancellation !== undefined) {
        await cancellation;
      }
    } finally {
      reader.releaseLock();
    }
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function cancelResponseBody(
  response: Response,
): Promise<ErrorOptions | undefined> {
  const responseBody =
    response.body as NodeReadableStream<Uint8Array> | null;
  if (responseBody === null) {
    return undefined;
  }

  try {
    await responseBody.cancel();
    return undefined;
  } catch (cause) {
    return { cause };
  }
}

export function createCaveHttpTransport(
  endpoint: string,
  options: CaveHttpTransportOptions = {},
): CaveTransport {
  const fetch = options.fetch ?? globalThis.fetch;
  const maxBodyBytes = resolveCaveHttpMaxBodyBytes(options);
  const healthUrl = new URL('/api/client/v1/health', `${endpoint}/`).toString();

  return {
    async health(context) {
      const response = await fetch(healthUrl, {
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          accept: 'application/json',
        },
        method: 'GET',
        redirect: 'error',
        ...(context?.signal === undefined ? {} : { signal: context.signal }),
      });
      if (!response.ok) {
        throw new CaveHttpTransportError(
          'http_status',
          'Cave Client v1 health request returned an unsuccessful HTTP status.',
          response.status,
          await cancelResponseBody(response),
        );
      }

      const contentLength = response.headers.get('content-length');
      if (
        contentLength !== null &&
        (!/^(?:0|[1-9]\d*)$/u.test(contentLength) ||
          Number(contentLength) > maxBodyBytes)
      ) {
        throw bodyLimit(
          maxBodyBytes,
          await cancelResponseBody(response),
        );
      }

      const bytes = await readBoundedBody(
        response,
        maxBodyBytes,
        context?.signal,
      );

      try {
        const serialized = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return JSON.parse(serialized) as CaveHealthResponse;
      } catch {
        throw new CaveHttpTransportError(
          'invalid_response',
          'Cave Client v1 response was not valid JSON.',
        );
      }
    },
  };
}
