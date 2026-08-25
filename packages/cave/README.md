# @opencoven/cave-client

A constrained Cave client with two entry points:

- `new CaveClient({ transport })` for caller-supplied transports
- `createDiscoveredCaveClient(...)` for runtime Client v1 discovery, pairing,
  and stored-credential validation over direct loopback

Importing the package performs no filesystem, network, or credential I/O. The
discovered helper reads Cave's `client-v1-discovery.json` only when an
operation is called, validates owner-local discovery metadata, and stores the
paired bearer together with non-secret authority-binding metadata in one
versioned `SecretStore` record per credential reference. Pairing sessions pin
to the exact discovered authority
record and freshness; if rediscovery shows a restart, record replacement, or
authority mismatch, `poll()`/`exchange()` fail locally before the pairing
secret is sent. Stored bearers are rediscovered against the same authority
identity and proven against the stored Cave `instanceId` through an
unauthenticated health request before every authenticated discovered call.
Mismatched credentials are cleared locally rather than sent to a different
Cave.

On Windows, `discoverCaveEndpoint()` also requires a reviewed native
`options.dependencies.windowsPathTrust` validator for the discovery root and
record path. Metadata-only checks, shell commands, and fabricated ACL trust are
rejected; the helper fails closed until a real validator is injected. A
trusted Windows validator remains authoritative when Node reports the
filesystem inode as `0`; Unix discovery still requires a positive inode.

## Shipped surface

- `new CaveClient({ transport })` and `createCaveClient(...)` preserve
  caller-owned transports for health, familiars, analytics, and reviewed
  contract-fixture helpers.
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

Contract fixture helpers are exported as
`parseCaveContractFixture`, `parseVerifiedCaveContractFixture`,
`verifyCaveContractFixtureDigest`, and `digestCaveContractFixture`.
The vendored fixture is byte-identical to `OpenCoven/coven-cave` commit
`4adc97b1bdafd1012ce4c66de598e82f49329f79`; its source paths and SHA-256 are
recorded in `fixtures/contract-fixture.provenance.json`.

Migration note: transports that returned `{ data: { status: "ok" } }` must now
return the complete Client v1 health envelope shown above. Consumers may keep
checking `health.status`, and can additionally gate pairing or feature use from
the normalized metadata.

## Compatibility, deadlines, and retry guidance

Cave Client v1 health accepts additive Cave API updates on major version `1`
and rejects incompatible API or minimum-client versions with
`incompatible_version`. There is no default timeout and no automatic retry.
Retry transient `timeout`, `not_found`, `service_unavailable`, or
`rate_limited` failures only after the operator confirms the local runtime is
ready. `reconcile_required` is not a transient retry instruction: reload
canonical state before continuing. Repair `stale_record`, pairing denial or
expiry, and incompatible versions before running the operation again.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
