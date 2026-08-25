# @opencoven/sdk-core

Transport-neutral errors, SemVer-accurate compatibility assessment,
allowlisted diagnostics, non-secret profiles, and in-memory secret stores. It
performs no I/O at import time.

The supported root API, pre-1.0 compatibility rules, and deprecation process
are documented in the repository
[compatibility policy](https://github.com/OpenCoven/sdk/blob/main/COMPATIBILITY.md)
and [support policy](https://github.com/OpenCoven/sdk/blob/main/SUPPORT.md).

## Errors

`normalizeError(error, options)` returns stable `system`, `code`, `retryable`,
and `operation` fields. It may also include an SDK-authored `message` plus
validated `requestId` and `statusCode` scalar metadata. Unknown transport
messages and payloads are never copied into the normalized object.

## Diagnostics

`createOpenCovenDiagnosticReport()` converts raw Cave health, Coven
discovery/health, secure-store status, and error observations into an immutable
version 1 report. The output contains only package/runtime versions, fixed
check identifiers and phases, approved capabilities and operations, bounded
stable-numeric Cave API and release versions, the final eight characters of a
valid Cave UUID identity, Coven protocol and transport kind, safe error
code/retryability/UUID diagnostic ID, and successful observation timestamps.

Unknown error codes, capabilities, and operations are discarded or mapped to
`unknown`. Endpoints, paths, records, process IDs, owners, prompts, messages,
causes, details, daemon output, and arbitrary content have no field in the
report model and are never copied. Reports are bounded to 16 unique supported
checks, validate canonical timestamps and version metadata, and reject
malformed runtime metadata.

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

## Non-secret profiles

`parseOpenCovenProfile()` validates immutable version 1 profiles containing
only a canonical name and optional connection preferences: `caveHome`,
`covenHome`, `defaultFamiliarId`, and `defaultProjectId`. Profiles cannot
contain credentials or direct endpoint overrides, so they do not replace
`SecretStore` custody or bypass runtime authority discovery. Use
`createOpenCovenProfileSecretReference(name)` to derive the separate
`opencoven.profile.<name>.cave` secret-store key.

`createMemoryOpenCovenProfileStore()` provides process-local ephemeral storage.
`createFileOpenCovenProfileStore({ path })` uses one bounded versioned JSON
file. Its path must be normalized and absolute, its existing parent directory
must be canonical, owned by the current Unix user, and inaccessible to group
and other users (normally mode `0700`). An existing file must be a non-symlink
regular file owned by that user with mode `0600`. Writes use an exclusive
same-directory temporary file, file and directory synchronization, and atomic
rename. Native Windows persistence fails closed until equivalent ownership
checks are available.

Version 0 documents migrate explicitly to version 1 on read. Malformed JSON,
invalid UTF-8, duplicate names, and invalid documents fail with
`corrupt_profile_store`; a caller must invoke `reset()` to replace safely
stored corrupt data. Mutations are serialized between stores in the same
process. The file store does not claim cross-process compare-and-swap semantics.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
