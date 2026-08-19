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
      minimumClientVersion: CAVE_CLIENT_VERSION,
      data: { status: 'ok' },
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
and rejects incompatible API or minimum-client versions. No request is made
until `health()` is called. Use `isCaveClientError(error)` when errors may cross
bundles or duplicate package installations; unlike `instanceof`, the guard is
stable across module instances.

Constructor operation defaults are overridden by per-call values. There is no
default timeout. The transport context is optional for source compatibility
and contains a composed signal plus the earliest monotonic deadline. A timeout
returns promptly even if the transport ignores the signal, but only a
cooperative transport stops underlying I/O. Do not log `error.cause` blindly.

Contract fixture helpers are exported as
`parseCaveContractFixture`, `parseVerifiedCaveContractFixture`,
`verifyCaveContractFixtureDigest`, and `digestCaveContractFixture`.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
