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
  CaveClientError,
} from '@opencoven/cave-client';

const cave = new CaveClient({
  transport: {
    health: async () => ({
      apiVersion: '1.0',
      minimumClientVersion: CAVE_CLIENT_VERSION,
      data: { status: 'ok' },
    }),
  },
});

try {
  await cave.health();
} catch (error) {
  if (error instanceof CaveClientError) {
    console.error(error.normalized.code, error.cause);
  }
}
```

The client accepts additive Cave API updates on supported major version `1`
and rejects incompatible API or minimum-client versions. No request is made
until `health()` is called. Use `isCaveClientError(error)` when errors may cross
bundles or duplicate package installations; unlike `instanceof`, the guard is
stable across module instances.

Contract fixture helpers are exported as
`parseCaveContractFixture`, `parseVerifiedCaveContractFixture`,
`verifyCaveContractFixtureDigest`, and `digestCaveContractFixture`.
