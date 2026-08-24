# @opencoven/cave-client

A constrained Cave client with two entry points:

- `new CaveClient({ transport })` for caller-supplied transports
- `createDiscoveredCaveClient(...)` for runtime Client v1 discovery, pairing,
  and stored-credential validation over direct loopback

Importing the package performs no filesystem, network, or credential I/O. The
discovered helper reads Cave's `client-v1-discovery.json` only when an
operation is called, validates owner-local discovery metadata, and stores the
paired bearer plus non-secret authority-binding metadata only through an
injected `SecretStore`. Pairing sessions pin to the exact discovered authority
record and freshness; if rediscovery shows a restart, record replacement, or
authority mismatch, `poll()`/`exchange()` fail locally before the pairing
secret is sent. Stored bearers are rediscovered against the same authority
identity before every authenticated discovered call and are cleared locally
rather than sent to a different Cave.

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
      minimumClientVersion: CAVE_CLIENT_VERSION,
      data: { status: 'ok' },
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
rejects incompatible API or minimum-client versions. When the backing transport
speaks Client v1, `health()` also returns `instanceId`, `pairingRequired`, the
running `releaseVersion`, and the advertised operation inventory additively.
Use `isCaveClientError(error)` when errors may cross bundles or duplicate
package installations; unlike `instanceof`, the guard is stable across module
instances.

Constructor operation defaults are overridden by per-call values. There is no
default timeout. The transport context is optional for source compatibility
and contains a composed signal plus the earliest monotonic deadline. A timeout
returns promptly even if the transport ignores the signal, but only a
cooperative transport stops underlying I/O. Do not log `error.cause` blindly.
The same controls apply to `createPairing()`, `session.poll()`,
`session.exchange()`, `credentialStatus()`, `forgetCredential()`,
`familiars()`, `familiarContract()`, and `familiarAnalytics()`. The discovered
helper currently owns Client v1 `health`, `pairing`, `credentialStatus`, and
`familiars`; custom transports can continue to provide the familiar contract
and analytics routes independently. `session.exchange()` requires an injected
credential store; the client never falls back to implicit in-memory storage.
Once an exchange attempt begins, later `poll()`/`exchange()` calls fail
locally unless the attempt failed before any transport send.

Contract fixture helpers are exported as
`parseCaveContractFixture`, `parseVerifiedCaveContractFixture`,
`verifyCaveContractFixtureDigest`, and `digestCaveContractFixture`.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
