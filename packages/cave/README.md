# @opencoven/cave-client

A constrained Cave health client. Consumers provide the transport; this package
does not discover endpoints or credentials, and health checks reject malformed
responses or incompatible minimum client versions deterministically. It also
exports public helpers for parsing and digest-verifying the reviewed
foundation-only Cave contract fixture.

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
cannot be mistaken for Client v1 envelopes. No request is made until `health()`
is called. Use `isCaveClientError(error)` when errors may cross bundles or
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
