# @opencoven/cave-client

A constrained Cave health client with explicit owner-local Client v1 discovery.
Imports perform no I/O. Consumers can either call
`createDiscoveredCaveClient()` or provide a narrow transport directly; neither
surface discovers credentials. Health checks reject malformed responses or
incompatible minimum client versions deterministically. The package also
exports public helpers for parsing and digest-verifying the reviewed
foundation-only Cave contract fixture.

```ts
import {
  createDiscoveredCaveClient,
  isCaveDiscoveryError,
} from '@opencoven/cave-client';

try {
  const cave = await createDiscoveredCaveClient({ timeoutMs: 2_000 });
  const health = await cave.health({ timeoutMs: 2_000 });
  console.log(cave.discovery?.endpoint, health.instanceId);
} catch (error) {
  if (isCaveDiscoveryError(error)) {
    console.error(error.code, error.diagnostics.phase);
  }
}
```

Discovery checks only `COVEN_CAVE_HOME/client-v1-discovery.json`,
`COVEN_HOME/cave/client-v1-discovery.json`, or the owner home fallback
`~/.coven/cave/client-v1-discovery.json`, in that order. The root and record
must be real owner-only filesystem objects. Unix ownership is checked against
the effective UID; Windows requires an injected
`CaveWindowsFileTrustValidator`. Records are size-bounded and must identify a
live process plus a path-free loopback HTTP endpoint with an explicit port.
Discovery and the initial compatibility health check share one absolute
deadline. The returned client binds the negotiated Cave instance ID and rejects
later health responses with `instance_changed` if that endpoint is replaced.

The built-in discovery transport sends only
`GET /api/client/v1/health`, omits credentials, rejects redirects and
unsuccessful HTTP statuses, and bounds streamed response bytes. It does not
expose arbitrary HTTP requests. Discovery diagnostics contain allowlisted
phases and limits, never filesystem paths or record contents. Sensitive native
errors remain only in `cause` and must not be logged blindly.

For a caller-supplied transport:

```ts
import {
  CAVE_CLIENT_VERSION,
  CaveClient,
  isCaveClientError,
} from '@opencoven/cave-client';

const cave = new CaveClient({
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

try {
  await cave.health({
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
```

The client accepts additive Cave API updates on supported major version `1`
and rejects incompatible API or minimum-client versions. `health()` returns a
normalized `status: "ok"` together with the authority's API and minimum-client
versions, capability and operation declarations, instance ID, release version,
and pairing requirement. Unknown additive fields are ignored safely and
unknown declarations remain available, while missing or malformed required
fields fail closed.
Proxy `{ ok: false, reason, error }` responses are normalized as failures and
cannot be mistaken for Client v1 envelopes. No request is made until `health()` is called on a directly constructed client.
`createDiscoveredCaveClient()` performs discovery and one compatibility health
request before it resolves. Use `isCaveClientError(error)` when errors may cross bundles or
duplicate package installations; unlike `instanceof`, the guard is stable
across module instances.

Constructor operation defaults are overridden by per-call values. There is no
default timeout. The transport context is optional for source compatibility
and contains a composed signal plus the earliest monotonic deadline. A timeout
returns promptly even if the transport ignores the signal, but only a
cooperative transport stops underlying I/O. Do not log `error.cause` blindly.
The same controls apply to `familiars()`, `familiarContract()`, and
`familiarAnalytics()`; analytics keeps `recentLimit` as a transport option
while accepting operation controls in the same options object.

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

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
