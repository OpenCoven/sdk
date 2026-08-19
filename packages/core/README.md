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

## Secrets

`createMemorySecretStore()` creates an isolated asynchronous store. Values
exist only in process memory and disappear when the store is discarded; this
package does not read environment variables, keychains, or files.
