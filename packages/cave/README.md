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
identity before every authenticated discovered call and are cleared locally
rather than sent to a different Cave.

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
- `discoverCaveEndpoint(options)` validates the owner-local
  `client-v1-discovery.json` record only when called.
- `createDiscoveredCaveClient(...)` layers runtime-only `health()`,
  `createPairing()`, `credentialStatus()`, and `forgetCredential()` over that
  discovery contract.
- Runtime exports also include `CAVE_CLIENT_VERSION`,
  `CAVE_PAIRING_SCOPES`, `CAVE_PAIRING_STATUSES`,
  `CAVE_FAMILIAR_PROPERTIES`, and `CAVE_ANALYTICS_WINDOWS`.

```ts
import {
  CAVE_CLIENT_VERSION,
  CaveClient,
  createDiscoveredCaveClient,
  isCaveClientError,
} from '@opencoven/cave-client';
import {
  createMemorySecretStore,
  createSecretStoreReference,
} from '@opencoven/sdk-core';

const transportBacked = new CaveClient({
  operation: {
    timeoutMs: 5_000,
  },
  transport: {
    health: async (context) => ({
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
  },
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
    observer: {
      onEvent(event) {
        console.log(event.phase);
      },
      onObserverError(error) {
        console.error(error);
      },
    },
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
`session.exchange()`, `credentialStatus()`, `forgetCredential()`,
`familiars()`, `familiarContract()`, and `familiarAnalytics()`. The discovered
helper currently owns Client v1 `health`, `pairing`, `credentialStatus`, and
`familiars`; custom transports can continue to provide the familiar contract
and analytics routes independently. `session.exchange()` requires an injected
credential store; the client never falls back to implicit in-memory storage. A
caller-supplied transport that uses `credentials` must satisfy
`CaveCredentialPersistingTransport` and return `authorityBinding` from
`pairingExchange()`. The binding is non-secret metadata only: endpoint URL,
opaque record identity, record device/inode, and freshness. The discovered
transport hashes the canonical discovery-record path into that opaque identity
instead of exposing the raw filesystem path in the public contract.
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

Contract fixture helpers are exported as
`parseCaveContractFixture`, `parseVerifiedCaveContractFixture`,
`verifyCaveContractFixtureDigest`, and `digestCaveContractFixture`.
The vendored fixture is byte-identical to `OpenCoven/coven-cave` commit
`e2b5b9d10d8498895ba9ff39ce6185f4ed873b57`; its source paths and SHA-256 are
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
ready; repair `stale_record`, `reconcile_required`, `pairing_denied`,
`pairing_expired`, or `incompatible_version` before running the operation
again.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
