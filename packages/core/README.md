# @opencoven/sdk-core

Transport-neutral errors, SemVer-accurate compatibility assessment, and an
in-memory secret store. It performs no I/O at import time.

Browser consumers can import `@opencoven/sdk-core/browser` for operation,
compatibility, pagination, error, and memory-secret APIs without bringing in
the Node-only local-discovery helpers from the root entry point.

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

## Pagination

`normalizePageOptions()` defaults `limit` to `50` and accepts safe integers from
`1` through `100`. Invalid limits are rejected rather than clamped. Cursors are
opaque, strictly canonical base64url strings of at most 512 characters; the SDK
validates their spelling and canonical trailing bits without decoding producer
semantics.

`iteratePages()` is lazy and requests one page at a time only as the caller
consumes it. It does not prefetch, retry, or default to walking the whole
corpus. Every iterator requires a positive safe-integer `maxPages` or a
caller-owned `AbortSignal`, stops before requesting a page beyond `maxPages`,
and refuses missing or repeated continuation cursors.

## Secrets

`createMemorySecretStore()` creates an isolated asynchronous store. Values
exist only in process memory and disappear when the store is discarded; this
package does not read environment variables, keychains, or files.

`createManagedMemorySecretStore()` adds key validation, `clear()`, idempotent
`dispose()`, and deterministic post-disposal errors without changing the
legacy store. Disposal removes retained references, but JavaScript strings
cannot be reliably zeroized. Neither memory store is persistent credential
storage. Higher-level clients may keep companion non-secret metadata beside a
secret through the same store contract, so callers should treat a secret-store
entry as scoped application state rather than as a single raw value slot.
Stores may implement optional `compareAndDelete(key, expectedValue)` to make
exact-value deletion atomic. Higher-level credential clients use that
capability when a backend must coordinate replacement and deletion across
independent processes.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
