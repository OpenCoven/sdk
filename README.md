# OpenCoven TypeScript SDK

> [!WARNING]
> **Experimental — not ready for public consumption.** This SDK is under active
> development, has not been security audited, and may change without notice. Do
> not use it for production workloads or with production credentials.

This workspace provides the experimental Phase 1b public OpenCoven SDK
workspace: runtime-only Cave discovery and pairing helpers, explicit Coven
daemon health adapters, coordinated SDK health reporting, and the
`opencoven` developer CLI.

## Release status

This source repository is public, but its packages are explicitly marked
private, are not published, and have standard publishing blocked. It is
experimental and not yet a security-audited release. Standard publishing also
requires `OPENCOVEN_RELEASE_AUTHORIZATION=publish`; remove or change these
gates only as part of an intentional release process. This phase documents and
verifies shipped contracts only; it does not publish packages or relax release
gates.

- [Support policy](SUPPORT.md)
- [Security policy](SECURITY.md)
- [Release process](RELEASING.md)

| Path | Package | Purpose |
| --- | --- | --- |
| `packages/core` | `@opencoven/sdk-core` | Transport-neutral errors, compatibility types, and in-memory secrets |
| `packages/cave` | `@opencoven/cave-client` | Constrained Cave transport plus runtime discovery/pairing helpers |
| `packages/coven` | `@opencoven/coven-client` | Constrained Coven discovery and health with explicit native transport-security providers |
| `packages/sdk` | `@opencoven/sdk` | Optional Cave/Coven coordination over already-configured clients |
| `packages/cli` | `@opencoven/dev-cli` | Sole owner of the `opencoven` binary plus native secure storage and fail-closed Coven checks |

The SDK performs no discovery, credential lookup, network, filesystem, or
daemon I/O at import time. Cave pairing/discovery is runtime-only and opt-in;
low-level Cave and Coven models, transports, and normalized errors remain
distinct.

## Choosing a package

| Need | Package |
| --- | --- |
| Shared errors, compatibility, or in-memory secrets | `@opencoven/sdk-core` |
| Cave health, runtime pairing/discovery, and reviewed Cave contract fixtures | `@opencoven/cave-client` |
| Coven daemon health | `@opencoven/coven-client` |
| Optional Cave/Coven coordination | `@opencoven/sdk` |
| Deterministic developer CLI output | `@opencoven/dev-cli` |

## Developer CLI contract

`@opencoven/dev-cli` ships only these experimental commands:

- `opencoven doctor`
- `opencoven discover`
- `opencoven cave pair`
- `opencoven cave status`
- `opencoven cave forget`
- `opencoven coven health`

Every command performs runtime discovery only when invoked, enforces an
explicit reviewed deadline, and keeps human and JSON output secret-free.
`cave pair` uses one absolute budget across create, poll, and exchange.
Production credentials require direct `@napi-rs/keyring` `1.3.0`; the CLI
fails closed with `secure_store_unavailable` and has no file, shell, or
environment fallback. `coven health` requires a real reviewed native
platform-security adapter; the default Node CLI reports
`platform_security_unavailable` rather than fabricating peer ownership proof.

## Caller-supplied transports

Low-level clients still accept caller-supplied transports for the exact
operations you need:

```ts
import { CaveClient, isCaveClientError } from '@opencoven/cave-client';

const cave = new CaveClient({
  transport: {
    health: async () => {
      const response = await fetch('https://example.invalid/health');
      return response.json();
    },
  },
});
```

The SDK does not own the URL, authentication, retry, or fetch policy. Callers
may provide cancellation and an optional SDK-enforced timeout:

```ts
const controller = new AbortController();

await cave.health({
  signal: controller.signal,
  timeoutMs: 5_000,
  observer: {
    onEvent(event) {
      telemetry.record(event);
    },
    onObserverError(error, event) {
      telemetry.recordObserverFailure(error, event);
    },
  },
});
```

There is no default timeout. A configured timeout rejects promptly even when a
transport ignores the supplied signal; only a cooperative transport can stop
its underlying I/O. Transports receive an optional context with the composed
`signal` and absolute monotonic `deadline`.

## Runtime Cave discovery and pairing

`@opencoven/cave-client` also ships an opt-in Client v1 helper that discovers
the local Cave endpoint at runtime, validates the owner-local discovery file,
and persists the exchanged bearer only through an injected `SecretStore`.
Pairing sessions pin to the exact discovered authority record and freshness, so
`poll()`/`exchange()` fail locally before sending the pairing secret if
rediscovery shows a restart, record replacement, or authority mismatch:

```ts
import { createDiscoveredCaveClient } from '@opencoven/cave-client';
import {
  createMemorySecretStore,
  createSecretStoreReference,
} from '@opencoven/sdk-core';

const cave = createDiscoveredCaveClient({
  credentials: {
    store: createMemorySecretStore(),
    reference: createSecretStoreReference('chat.cave'),
  },
});

const session = await cave.createPairing({
  appName: 'OpenCoven Chat',
  installationId: 'chat-install-1',
  scopes: ['chat:read', 'chat:write'],
});

await session.poll();
await session.exchange();
```

The discovered helper performs no import-time I/O. Discovery, pairing, health,
and stored-credential checks happen only when you call those methods.
`session.exchange()` requires an injected credential store; there is no
implicit fallback store. It is also local single-flight: once an exchange
attempt begins, later `poll()`/`exchange()` calls fail locally unless the
attempt failed before any transport send. Pre-send authority mismatches keep
the pairing secret ready and surface retryable `reconcile_required`; once an
exchange request reaches a transport, a later timeout, abort, or discovered
fetch rejection still spends that session locally.

When you inject `credentials` into `new CaveClient({ transport, credentials })`,
the transport must satisfy `CaveCredentialPersistingTransport` and return the
non-secret `authorityBinding` metadata from `pairingExchange()`. The public
binding carries the endpoint URL, an opaque record identity, device/inode, and
freshness, without exposing the canonical discovery-record path directly.

## Coordinated health

| API | Behavior |
| --- | --- |
| `health()` | Checks configured clients in order and rejects on the first failure |
| `healthReport()` | Starts configured checks concurrently and reports each as `healthy`, `unhealthy`, or `not_configured` |

Top-level SDK timeouts are total budgets across all configured clients.
Per-client timeouts and signals can make one check stricter, but cannot extend
the global deadline. Lifecycle events remain Cave- or Coven-specific and
contain only allowlisted normalized metadata.

Client errors expose stable normalized metadata and retain the original failure
as `cause`:

```ts
try {
  await cave.health();
} catch (error) {
  if (isCaveClientError(error)) {
    console.error(error.normalized.code, error.normalized.requestId);
    console.error(error.cause);
  }
}
```

Do not serialize or log `cause` blindly: it may contain caller or transport
data. Observer events exclude causes, stacks, transport messages, and response
payloads.

## Runtime control errors

| Code | Meaning | Retryable |
| --- | --- | --- |
| `timeout` | The configured operation deadline elapsed | Yes |
| `aborted` | A caller-owned signal cancelled the operation | No |
| `invalid_options` | A timeout or signal option was invalid | No |

Timeouts must be positive safe integers no greater than `2_147_483_647`.
Automatic retries are intentionally not performed.
Retry only transient `timeout`, `not_found`, `connect_failure`,
`service_unavailable`, or `rate_limited` failures after the operator confirms
the local runtime is ready. Version, authority-binding, ownership,
secure-store, and platform-security errors require repair before rerunning.

## Production checklist

- Configure an explicit timeout for every remote operation.
- Define which application component owns each cancellation signal.
- Implement both observer callbacks and route observer failures to a safe sink.
- Supply application-managed persistent credential storage; SDK memory stores
  are non-persistent.
- Treat error causes as sensitive and log only normalized or event metadata.
- Complete the separate release-readiness gate before publishing or production
  adoption; these packages remain private and experimental.

Reviewed Cave and Coven fixture bytes are committed under their client
packages and verified locally. Refresh them with
`pnpm sync:contracts -- --cave-root <path> --coven-root <path>` before running
the contract verifier. No authority source tree is imported at runtime.

## Validation

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
node scripts/verify-contracts.mjs
node scripts/verify-package.mjs
node scripts/verify-release-readiness.mjs
pnpm test:coverage
pnpm test:stress
pnpm lint
```

`corepack pnpm@10.34.0 verify` runs that canonical sequence after installation.

`pack-public-packages.mjs` is the reusable tarball producer for cross-repository
consumers such as the Chat packed-package canary. It prints JSON containing a
process-created temp `artifactRoot` plus the packed tarball paths for callers
that intentionally keep those artifacts.

Runnable deterministic examples are documented in [`examples/README.md`](examples/README.md).

## Local security checks

Install the repository hooks once per checkout:

```bash
pre-commit install
```

The hook scans staged changes for likely credentials and private keys. To scan
the current branch's full Git history before sharing or publishing work, install
Gitleaks and run:

```bash
gitleaks git .
```

## License

OpenCoven SDK is dual-licensed under AGPL-3.0-only OR MIT. See
[`LICENSE`](LICENSE).
