# @opencoven/cave-client

A constrained Cave client with three entry points:

- `new CaveClient({ transport })` for caller-supplied transports
- `createDiscoveredCaveClient(...)` for runtime Client v1 discovery, pairing,
  and stored-credential validation over direct loopback
- `createManagedCaveClient(...)` for native adapters that retain pairing
  secrets and bearer credentials outside JavaScript

Importing the package performs no filesystem, network, or credential I/O. The
discovered helper reads Cave's `client-v1-discovery.json` only when an
operation is called, validates owner-local discovery metadata before and after
the bounded read, and stores the
paired bearer together with non-secret authority-binding metadata in one
versioned `SecretStore` record per credential reference.

Discovery v1 retains the legacy authority-pinning and plaintext credential
headers for compatibility. Discovery v2 publishes immutable
`hpke-bound-v1` authority metadata. In v2, pairing poll/exchange and the five
canonical reads carry their pairing secret or bearer only inside an HPKE
Base-mode request and accept application status/body only from an Auth-mode
response. Once v2 is observed, protected calls never fall back to v1
plaintext. Runtime restarts and unauthenticated responses preserve stored
credentials; only an Auth-opened inner result may report credential
unauthorized/revoked state.

The supported root API, pre-1.0 compatibility rules, and deprecation process
are documented in the repository
[compatibility policy](https://github.com/OpenCoven/sdk/blob/main/COMPATIBILITY.md)
and [support policy](https://github.com/OpenCoven/sdk/blob/main/SUPPORT.md).

Discovery accepts only an explicit-port HTTP loopback authority at
`127.0.0.1`, `localhost`, or `[::1]`. Discovered requests omit ambient
credentials, disable cache reuse, reject redirects, enforce a positive safe
response-byte limit, and cancel streamed bodies when that limit or the shared
operation deadline is exceeded.

On Windows, `discoverCaveEndpoint()` also requires a reviewed native
`options.dependencies.windowsPathTrust` validator for the discovery root and
record path. Metadata-only checks, shell commands, and fabricated ACL trust are
rejected; the helper fails closed until a real validator is injected. A
trusted Windows validator must also return a stable native identity and
implement `validateOpenedFile(...)` when Node reports the filesystem device or
inode as `0`, allowing the path snapshots to be compared with the actual opened
record. Unix discovery still requires a positive inode.

## Shipped surface

- `new CaveClient({ transport })` and `createCaveClient(...)` preserve
  caller-owned transports for health, familiars, analytics, and reviewed
  contract-fixture helpers.
- `new CaveClient({ transport, credentialCustody: { mode: 'managed-native' } })`
  selects a narrow native-only pairing and credential boundary for webviews.
  It cannot be combined with a JavaScript `SecretStore`.
- Five optional methods on the same caller-owned `CaveTransport` add strict
  one-page Client v1 canonical reads through `listFamiliars()`,
  `listProjects()`, `listConversations()`, `getConversation()`, and
  `listConversationMessages()`.
- Four bounded async iterators, `iterateFamiliars()`, `iterateProjects()`,
  `iterateConversations()`, and `iterateConversationMessages()`, lazily compose
  the list routes. There is intentionally no iterator for the single-item
  `getConversation()` detail route.
- `discoverCaveEndpoint(options)` validates the owner-local
  `client-v1-discovery.json` record only when called.
- `createDiscoveredCaveClient(...)` layers runtime-only `health()`,
  pairing, credential, legacy familiar, and canonical-read operations over
  that discovery contract.
- `createManagedCaveClient(...)` keeps secret-bearing wire fields and
  credentials behind narrow native calls while the SDK validates all
  non-secret Client v1 envelopes, metadata, cursors, DTOs, and errors.
- Managed adapters that observe discovery v2 receive the exact frozen
  discovery metadata and must implement the named `*Hpke` methods for the
  seven protected operations. Each returned result carries a strict
  `authentication: { mechanism: "hpke-bound-v1", keyId }` attestation matching
  discovery. There is no generic native request escape hatch.
- Runtime exports also include `CAVE_CLIENT_VERSION`,
  `CAVE_PAIRING_SCOPES`, `CAVE_PAIRING_STATUSES`,
  `CAVE_FAMILIAR_PROPERTIES`, and `CAVE_ANALYTICS_WINDOWS`.

```ts
import {
  CAVE_CLIENT_VERSION,
  CaveClient,
  createDiscoveredCaveClient,
  isCaveClientError,
  type CaveTransport,
} from '@opencoven/cave-client';
import {
  createMemorySecretStore,
  createSecretStoreReference,
} from '@opencoven/sdk-core';

const canonicalMetadata = {
  apiVersion: '1.0',
  capabilities: [
    'familiars',
    'projects',
    'conversations',
    'conversation-messages',
    'cursors',
  ],
  minimumClientVersion: CAVE_CLIENT_VERSION,
  operations: [
    'familiars.list',
    'projects.list',
    'conversations.list',
    'conversations.read',
    'messages.list',
  ],
} as const;

const transport = {
  health: async () => ({
    apiVersion: '1.0',
    capabilities: ['health', 'pairing'],
    minimumClientVersion: CAVE_CLIENT_VERSION,
    operations: ['health.read', 'pairing.create'],
    data: {
      instanceId: 'cave-instance-id',
      pairingRequired: true,
      releaseVersion: '0.3.9',
    },
  }),
  listFamiliars: async () => ({
    ...canonicalMetadata,
    data: { familiars: [] },
  }),
  listProjects: async () => ({
    ...canonicalMetadata,
    data: { projects: [] },
  }),
  listConversations: async () => ({
    ...canonicalMetadata,
    data: { conversations: [] },
  }),
  getConversation: async (conversationId) => ({
    ...canonicalMetadata,
    data: {
      conversation: {
        id: conversationId,
        familiarId: 'familiar-id',
        updatedAt: new Date().toISOString(),
      },
    },
  }),
  listConversationMessages: async () => ({
    ...canonicalMetadata,
    data: { messages: [] },
  }),
} satisfies CaveTransport;

const transportBacked = new CaveClient({
  operation: {
    timeoutMs: 5_000,
    observer: {
      onEvent(event) {
        console.log(event.phase);
      },
      onObserverError(error) {
        console.error(error);
      },
    },
  },
  transport,
});

const discovered = createDiscoveredCaveClient({
  credentials: {
    store: createMemorySecretStore(),
    reference: createSecretStoreReference('chat.cave'),
  },
});

try {
  await transportBacked.health({
    signal: new AbortController().signal,
  });
} catch (error) {
  if (isCaveClientError(error)) {
    console.error(error.normalized.code, error.cause);
  }
}

const session = await discovered.createPairing({
  appName: 'OpenCoven Chat',
  installationId: 'chat-install-1',
  scopes: ['chat:read', 'chat:write'],
});

await session.poll();
const credential = await session.exchange();
console.log(credential.id, credential.scopes);
```

## Managed native credential custody

Webview consumers can implement `CaveManagedNativeTransport` in a reviewed
native bridge and pass it to `createManagedCaveClient()`. The adapter exposes
operation-specific methods rather than a generic authenticated fetch primitive.
Pairing creation returns an opaque request handle plus only `requestId` and
`expiresAt`; polling and exchange use that handle without returning the pairing
secret. Exchange stages the bearer in native custody and returns a separate
opaque commit handle, non-secret authority binding, and credential metadata.
The SDK validates that metadata before calling `pairingCommit()`. Validation,
timeout, abort, and late-completion failures trigger best-effort
`pairingDiscard()` by exact commit handle.

```ts
import {
  createManagedCaveClient,
  type CaveManagedNativeTransport,
} from '@opencoven/cave-client';

declare const nativeCave: CaveManagedNativeTransport;

const cave = createManagedCaveClient({
  operation: { timeoutMs: 5_000 },
  transport: nativeCave,
});

const session = await cave.createPairing({
  appName: 'OpenCoven Chat',
  installationId: 'chat-install-1',
  scopes: ['chat:read'],
});

await session.poll();
const credential = await session.exchange();
```

Native raw responses use `{ statusCode, payload }`. Payloads must be plain,
finite JSON data with no accessors, symbols, cycles, sparse or decorated
arrays, secret- or bearer-named fields, more than 4,096 values, or more than
64 KiB of string content. Handles are bounded opaque strings and never appear
in pairing-session serialization, normalized errors, or observer events.
Credential state and local forget return status only, never stored values.
Native bridge rejections are replaced with a generic `service_unavailable`
failure so their messages, codes, details, and causes cannot cross into public
errors or observers. Protocol failures must use a non-2xx raw Client v1
response when the SDK should preserve the structured error.
Existing caller-owned `CaveTransport` and `SecretStore` paths are unchanged.

Canonical success and explicit error envelopes require
`apiVersion: "1.0"`, `minimumClientVersion`, `capabilities`, and a nonempty
`operations` inventory. Declaration IDs are bounded, canonical, and unique.
Explicit Cave error envelopes remain explicit failures rather than malformed
responses: code, retryability, details, and request ID remain available, while
the producer message stays on the original `cause`. `CaveConversation.exitCode`
is absent when the producer omits it, preserves a present `null`, and otherwise
requires a finite safe integer. `CaveConversationMessage.parentId` is required
and nullable. `activeSessions`, `attachmentCount`, and `toolCount` require
finite, safe, nonnegative integers.

`health()` accepts additive Cave API updates on supported major version `1` and
rejects incompatible API or minimum-client versions. It returns normalized
`status: "ok"` together with the authority's API and minimum-client versions,
capability and operation declarations, instance ID, release version, and
pairing requirement. Unknown additive fields are ignored safely and unknown
declarations remain available. Missing or malformed required fields fail
closed, while explicit empty `capabilities`/`operations` arrays are preserved.
Proxy `{ ok: false, reason, error }` responses are normalized as failures and
cannot be mistaken for Client v1 envelopes. No request is made until `health()`
is called. Use `isCaveClientError(error)` when errors may cross bundles or
duplicate package installations; unlike `instanceof`, the guard is stable
across module instances.

Constructor operation defaults are overridden by per-call values. There is no
default timeout. The transport context is optional for source compatibility
and contains a composed signal plus the earliest monotonic deadline. A timeout
returns promptly even if the transport ignores the signal. If `exchange()`
times out or is aborted before credential persistence begins, any later
transport result is discarded before the bearer can be written. Once
persistence starts, the client commits through one atomic credential-record
write and best-effort exact-value cleanup if that write lands after
timeout/abort. Duplicate package copies share process-global mutation queues,
and stores with `compareAndDelete()` preserve exact-value deletion across
processes. Only a cooperative transport stops underlying I/O. Do not log
`error.cause` blindly.
The same controls apply to `createPairing()`, `session.poll()`,
`session.exchange()`, `credentialStatus()`, `forgetCredential()`, canonical
reads, `familiars()`, `familiarContract()`, and `familiarAnalytics()`. The
discovered helper owns Client v1 health, pairing, credential status, canonical
reads, and the legacy familiar roster; custom transports can continue to
provide the familiar contract and analytics routes independently.
`session.exchange()` requires an injected credential store; the client never
falls back to implicit in-memory storage. A
caller-supplied transport that uses `credentials` must satisfy
`CaveCredentialPersistingTransport` and return `authorityBinding` from
`pairingExchange()`. The binding is non-secret metadata only: Cave instance
ID, endpoint URL, opaque record identity, record device/inode, and freshness.
The discovered transport hashes the canonical discovery-record path into that
opaque identity instead of exposing the raw filesystem path in the public
contract. It brackets the single-use exchange with unauthenticated health
proofs and persists the bearer only if the instance ID remains stable. A
failed post-exchange proof is non-retryable for that spent session and requires
a new pairing. These separate loopback health requests are defense in depth:
the current Client v1 contract cannot atomically bind the subsequent
pairing-secret or bearer request to the process that answered health. The 0.1
release remains blocked on the producer protocol work in
[OpenCoven/coven-cave#4996](https://github.com/OpenCoven/coven-cave/issues/4996)
and real-authority conformance.
### Managed native credential custody

Webviews such as Tauri Chat must not receive pairing secrets or exchanged
bearers. Browser/webview consumers must import the browser-safe managed
subpath, which has no Node filesystem, network, crypto, or `Buffer`
dependency. Supply a `CaveManagedCredentialTransport` through its factory
instead of injecting `credentials`:

```ts
import {
  createManagedCaveClient,
  type CaveManagedCredentialTransport,
} from '@opencoven/cave-client/managed';

const transport = {
  health: async () => nativeCave.health(),
  managedPairingCreate: async (request) => nativeCave.pairingCreate(request),
  managedPairingPoll: async (requestId) => nativeCave.pairingPoll(requestId),
  managedPairingExchange: async (requestId) => nativeCave.pairingExchange(requestId),
  managedCredentialStatus: async () => nativeCave.credentialStatus(),
  managedForgetCredential: async () => nativeCave.forgetCredential(),
} satisfies CaveManagedCredentialTransport;

const cave = createManagedCaveClient({
  transport,
});
```

This bridge has no generic fetch method. Native code alone retains the pairing
secret, sends pairing-secret headers, consumes the exchange bearer, and
persists the credential. Its create result is limited to `requestId` and
`expiresAt`; poll receives only that opaque request ID; exchange returns only
credential metadata. Credential status and forget use narrow non-secret
results, including replacement-race reporting. The SDK rejects malformed or
secret-bearing native results, validates every exposed metadata/status value,
and keeps timed-out or aborted managed exchange attempts terminal so it never
automatically duplicates a persistent mutation.

When Chat needs to display or diagnose discovery, Rust supplies only
owner-checked bytes and opaque record metadata through
`CaveManagedDiscoverySource`; the SDK parses Client v1 discovery itself, so
the webview never receives a filesystem capability:

```ts
import {
  discoverManagedCaveEndpoint,
  type CaveManagedDiscoverySource,
} from '@opencoven/cave-client/managed';

const source = {
  read: async () => await invoke('cave_discovery_snapshot'),
} satisfies CaveManagedDiscoverySource;

const endpoint = await discoverManagedCaveEndpoint(source);
```

The native response is restricted to discovery JSON bytes plus an
owner-checked opaque identity, device/inode metadata, and whether its PID is
alive. Unsupported fields, invalid loopback URLs, stale PIDs, malformed UTF-8,
and oversized records fail SDK validation. Discovery snapshots reject repeated
object identities and cap record bytes at 64 KiB before cloning or encoding
them; owner identity metadata has its own 1,024-character limit. Rust does not
shape an endpoint DTO or compatibility result for JavaScript.

Managed custody removes credential material from JavaScript; it does **not**
solve authority endpoint takeover. Client v1 still lacks atomic request binding,
so the release remains blocked on
[OpenCoven/coven-cave#4996](https://github.com/OpenCoven/coven-cave/issues/4996)
and real-authority conformance.

A successful `session.poll()` keeps the session ready for one later
`session.exchange()`. While a poll is in flight, later `poll()`/`exchange()`
calls fail locally with retryable `operation_in_progress` instead of sending
the pairing secret twice. Once an exchange attempt begins, later
`poll()`/`exchange()` calls fail locally unless the attempt failed before any
transport send. Pre-send pinned-authority failures keep the pairing secret
ready and surface retryable `reconcile_required`. Discovered fetch/network
rejections during `session.exchange()` are terminal for that session because
the client cannot prove whether the request was sent.
Credential reads observe one coherent stored record per reference: the previous
committed credential, the new committed credential, or no credential at all.
Malformed or mismatched records fail closed and are invalidated locally before
their bearer can be sent. `forgetCredential()` returns `false` only when the
client can confirm there is no stored credential left to delete; concurrent
record replacement surfaces retryable `credential_update_in_progress`, and
store read/delete failures stay explicit instead of being reported as a
successful absence.

Canonical reads work with either optional caller-supplied `CaveTransport`
methods or `createDiscoveredCaveClient()`. A caller-supplied transport owns its
I/O, authority, authentication, and retry policy. The discovered transport uses
the existing owner-local discovery, credential validation, unauthenticated
instance proof, and authenticated request path. In both cases the client owns
one observer lifecycle and strict versioned-envelope/DTO parsing; it never
automatically retries.

The discovered client issues only these deterministic `GET` routes:

| Method | Route |
| --- | --- |
| `listFamiliars()` | `/api/client/v1/familiars?limit=<limit>[&cursor=<cursor>]` |
| `listProjects()` | `/api/client/v1/projects?limit=<limit>[&cursor=<cursor>]` |
| `listConversations()` | `/api/client/v1/conversations?limit=<limit>[&cursor=<cursor>]` |
| `getConversation(id)` | `/api/client/v1/conversations/<encodeURIComponent(id)>` |
| `listConversationMessages(id)` | `/api/client/v1/conversations/<encodeURIComponent(id)>/messages?limit=<limit>[&cursor=<cursor>]` |

List query parameters are always inserted in `limit`, then optional `cursor`
order. Conversation IDs are validated, dot path segments are rejected, and
the complete ID is encoded as one path segment.

List calls use the shared core `normalizePageOptions()` rules: `limit` defaults
to exactly `50`, accepts only safe integers from `1` through `100`, and rejects
invalid values rather than clamping. Cursors are opaque, strict canonical
base64url strings of at most 512 characters. The SDK validates spelling and
canonical trailing bits but never decodes producer semantics. Every one-page
list returns one `Page<T>`.

The four iterators require either a positive safe-integer `maxPages` or a
caller-owned `AbortSignal`. They are lazy, request one page at a time, and do
not prefetch, retry, or default to downloading the whole corpus. A mutable
conversation or message walk is not a snapshot: if Cave returns
`reconcile_required`, the caller must discard derived paging state and reload
canonical state. The SDK never automatically retries that error, especially
when message branch drift reports
`details.reason: "resume_from_canonical_state"`.

```ts
const projects = await transportBacked.listProjects({
  limit: 50,
  cursor: 'eyJwYWdlIjoyfQ',
});

const conversation = await transportBacked.getConversation('conversation/1');
const messages = await transportBacked.listConversationMessages(
  conversation.id,
);
const firstTwoProjectPages = transportBacked.iterateProjects({ maxPages: 2 });
console.log(
  projects.data,
  conversation.updatedAt,
  messages.data,
  await Array.fromAsync(firstTwoProjectPages),
);
```

The legacy `familiars()`, `familiarContract()`, `familiarAnalytics()`, and
`CaveFamiliar` contracts remain separate and unchanged. The canonical
`listFamiliars()` method coexists with the legacy plural `familiars()` method.

Public-contract and packed-package tests import the canonical methods,
iterators, and types from `@opencoven/cave-client`'s package root and exercise
the generated tarball without source-checkout or deep-import dependencies.

## HPKE-bound Client v1 authority

The direct Node transport implements Cave's exact RFC 9180 suite
`DHKEM(X25519, HKDF-SHA256) / HKDF-SHA256 / AES-256-GCM` (`32/1/2`) with
RFC 8785 JSON, the producer-defined binary AAD, and canonical
RFC 3986-sorted routes. Every attempt creates a fresh 32-byte request nonce,
fresh X25519 response-recipient key, HPKE encapsulation, and monotonic
millisecond timestamp.

Protected wire operations are exactly `pairing.poll`, `pairing.exchange`,
`familiars.list`, `projects.list`, `conversations.list`,
`conversations.read`, and `messages.list`. Health and pairing create remain
public. Plaintext stale-key guidance permits one rediscovery/reseal.
Authenticated replay-capacity `503` permits one deadline-bounded retry using
the authenticated `retry-after`. Pairing exchange is not retried after an
unproved dispatch; the authenticated replay-capacity result is the only
post-open retry case.

Plaintext, forged, replacement-listener, malformed, or incorrectly sealed
responses map to the fixed `invalid_response` transport failure. They cannot
delete a credential, report it revoked, or start re-pairing. Plaintext
`authority_unavailable` maps to retryable `service_unavailable` while
preserving credentials and pairing state.

Contract fixture helpers are exported as
`parseCaveContractFixture`, `parseVerifiedCaveContractFixture`,
`verifyCaveContractFixtureDigest`, and `digestCaveContractFixture`.
The vendored contract fixture and HPKE vectors are byte-identical to
`OpenCoven/coven-cave` merge
`1d16736e637de384ebf7423c05862d66860478c4`, including the canonical
encoded-path follow-up from
[OpenCoven/coven-cave#5071](https://github.com/OpenCoven/coven-cave/pull/5071).
Their SHA-256 values remain
`1b78125dab5b77414efd2d34e13315f542b197715ed26c6521f588e299abe61d`
and
`f806967291de12175277b6b24ac3c7bba912ae760fd8227fb21b1a4d5f5e6797`;
paths and provenance are recorded in
`fixtures/contract-fixture.provenance.json`.

Protected route AAD preserves exact canonical `encodeURIComponent` segment
bytes. Conversation IDs containing `/`, `?`, `#`, spaces, Unicode, or literal
`%` dispatch normally; lowercase, malformed, double-encoded, dot/dotdot,
empty, and backslash segments fail closed. Query canonicalization is unchanged.

Migration note: transports that returned `{ data: { status: "ok" } }` must now
return the complete Client v1 health envelope shown above. Consumers may keep
checking `health.status`, and can additionally gate pairing or feature use from
the normalized metadata.

## Compatibility, deadlines, and retry guidance

Cave Client v1 health accepts additive Cave API updates on major version `1`
and rejects incompatible API or minimum-client versions with
`incompatible_version`. There is no default timeout. Apart from the two
bounded HPKE protocol retries described above, operations are not retried.
Retry other transient `timeout`, `not_found`, `service_unavailable`, or
`rate_limited` failures only after the operator confirms the local runtime is
ready. `reconcile_required` is not a transient retry instruction: reload
canonical state before continuing.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
