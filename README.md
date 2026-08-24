# OpenCoven TypeScript SDK

> [!WARNING]
> **Experimental — not ready for public consumption.** This SDK is under active
> development, has not completed its first-release security review, and may
> change without notice. Do not use it for production workloads or with
> production credentials.

This workspace contains the experimental TypeScript SDK and developer CLI for
OpenCoven clients, transports, compatibility contracts, and shared protocol
infrastructure.

## Release status

This source repository is public, but its packages are explicitly marked
private, are not published, and have standard publishing blocked. Standard
publishing also requires `OPENCOVEN_RELEASE_AUTHORIZATION=publish`; remove or
change these gates only as part of the intentional, reviewed release process.

- [Roadmap](docs/ROADMAP.md)
- [0.1 read-only release design](docs/superpowers/specs/2026-08-22-sdk-0.1-read-only-release-design.md)
- [0.1 dependency-ordered delivery program](docs/superpowers/plans/2026-08-22-sdk-0.1-delivery-program.md)
- [GitHub delivery program](https://github.com/OpenCoven/sdk/issues/31)
- [Support policy](SUPPORT.md)
- [Security policy](SECURITY.md)
- [Release process](RELEASING.md)
- [Contributing](CONTRIBUTING.md)

## Current delivery program

The first public release is intentionally scoped as a secure **read-only**
protocol release. A packed consumer must be able to discover Cave and Coven,
negotiate compatibility, pair through user consent, retain credentials in
native custody, validate live IPC identity, and read canonical state.

Message sending, streaming, attachments, task handoffs, GitHub mutations, and
offline mutation queues are explicitly deferred to separately reviewed
post-release authority milestones. The roadmap and issue program above are the
current plan of record; older Phase 0 plans remain historical evidence rather
than the active release checklist.

| Path | Package | Current purpose |
| --- | --- | --- |
| `packages/core` | `@opencoven/sdk-core` | Transport-neutral errors, compatibility/discovery contracts, operation controls, and in-memory secret abstractions |
| `packages/cave` | `@opencoven/cave-client` | Constrained Cave client, current familiar operations, and reviewed Cave contract fixtures |
| `packages/coven` | `@opencoven/coven-client` | Explicit owner-local Coven discovery plus constrained health transports |
| `packages/sdk` | `@opencoven/sdk` | Optional Cave/Coven coordination without merging source-system identity or errors |
| `packages/cli` | `@opencoven/dev-cli` | Sole owner of the `opencoven` binary; help/version are implemented while operational scope is being decided |

## Runtime ownership and import purity

Importing any public package performs no discovery, credential lookup, network,
filesystem, process, socket, or daemon I/O.

Cave operations currently use caller-supplied narrow transports. Coven also
offers explicit runtime discovery and owner-local health transport factories;
those functions perform I/O only when called and require reviewed platform
security providers where Node cannot prove connected-peer or pipe identity.

Cave and Coven models, transports, authorities, and normalized errors remain
distinct. The coordination package composes them without pretending they share
one endpoint, credential, or failure model.

## Choosing a package

| Need | Package |
| --- | --- |
| Shared errors, compatibility/discovery contracts, operation controls, or in-memory secrets | `@opencoven/sdk-core` |
| Cave health, familiar operations, or reviewed Cave contract fixtures | `@opencoven/cave-client` |
| Explicit Coven discovery and owner-local daemon health | `@opencoven/coven-client` |
| Optional Cave/Coven coordination | `@opencoven/sdk` |
| Deterministic help/version output from the global binary | `@opencoven/dev-cli` |

## Caller-supplied Cave transports

Supply the narrow transport needed by the operation:

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

The Cave client does not own the URL, authentication, retry, or fetch policy in
this current surface. Callers may provide cancellation and an optional
SDK-enforced timeout:

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

## Explicit Coven discovery

`@opencoven/coven-client` may discover the owner-local daemon through an
explicit runtime call. Importing the package remains pure. Discovery through a
CLI fallback requires a trusted executable resolver; Unix and Windows health
transports require the platform-appropriate connected-peer or pipe-ownership
provider.

```ts
import {
  createDiscoveredCovenClient,
  type CovenUnixPeerIdentityAdapter,
} from '@opencoven/coven-client';

declare const nativeUnixPeerIdentity: CovenUnixPeerIdentityAdapter;
declare const trustedCovenPath: string;

const coven = await createDiscoveredCovenClient({
  discovery: {
    dependencies: {
      resolveExecutable: () => trustedCovenPath,
    },
  },
  transportSecurity: {
    platform: 'unix',
    peerIdentity: nativeUnixPeerIdentity,
  },
});

await coven.health({ timeoutMs: 5_000 });
```

The package deliberately provides no pathname-only, shell, `lsof`, PowerShell,
private-Node-internals, or permissive trust fallback.

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
data. Observer events exclude causes, stacks, transport messages, response
payloads, and authority secrets.

## Runtime control errors

| Code | Meaning | Retryable |
| --- | --- | --- |
| `timeout` | The configured operation deadline elapsed | Yes |
| `aborted` | A caller-owned signal cancelled the operation | No |
| `invalid_options` | A timeout or signal option was invalid | No |

Timeouts must be positive safe integers no greater than `2_147_483_647`.
Automatic retries are intentionally not performed.

## Production checklist

- Do not adopt these unpublished experimental packages in production yet.
- Configure an explicit timeout for every remote or IPC operation.
- Define which application component owns each cancellation signal.
- Implement both observer callbacks and route observer failures to a safe sink.
- Supply application-managed persistent credential storage; SDK memory stores
  are non-persistent.
- Supply reviewed native IPC identity providers where required.
- Treat error causes as sensitive and log only normalized or event metadata.
- Complete the dependency-ordered 0.1 program, real-authority conformance,
  security disposition, and release validation before production adoption.

Reviewed Cave and Coven fixture bytes are committed under their client
packages and verified locally. Refresh them with
`pnpm sync:contracts -- --cave-root <path> --coven-root <path>` before running
the contract verifier. No authority source tree is imported at runtime.

The 0.1 program adds producer provenance and producer/vendor/pack/consumer
parity so a local digest cannot remain green while its authority has advanced.

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
process-created temporary `artifactRoot` plus the packed tarball paths for
callers that intentionally retain those artifacts.

Runnable deterministic examples are documented in
[`examples/README.md`](examples/README.md).

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
