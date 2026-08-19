# @opencoven/sdk-core

Transport-neutral errors, SemVer-accurate compatibility assessment, and an
in-memory secret store. It performs no I/O at import time.

## Errors

`normalizeError(error, options)` returns stable `system`, `code`, `retryable`,
and `operation` fields. It may also include an SDK-authored `message` plus
validated `requestId` and `statusCode` scalar metadata. Unknown transport
messages and payloads are never copied into the normalized object.

## Compatibility

`assessCompatibility(minimumClientVersion, clientVersion)` applies SemVer
precedence, including prerelease identifiers, and throws for invalid SemVer.

## Operation control

`runOperation()` and `createOperationScope()` provide optional positive
safe-integer timeouts, structural `AbortSignal` support, composed signals, and
monotonic deadlines. There is no default timeout. Timeout errors use code
`timeout` and are retryable; caller cancellation uses `aborted` and is not
retryable; invalid controls use `invalid_options`.

Lifecycle observers receive sanitized `start`, `success`, `failure`, `timeout`,
and `abort` events. An `onEvent` failure is sent to `onObserverError` without
changing the operation result. If `onObserverError` also throws, that error
propagates because no safe reporting sink remains.

## Secrets

`createMemorySecretStore()` creates an isolated asynchronous store. Values
exist only in process memory and disappear when the store is discarded; this
package does not read environment variables, keychains, or files.

`createManagedMemorySecretStore()` adds key validation, `clear()`, idempotent
`dispose()`, and deterministic post-disposal errors without changing the
legacy store. Disposal removes retained references, but JavaScript strings
cannot be reliably zeroized. Neither memory store is persistent credential
storage.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
