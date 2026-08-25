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
| `packages/cave` | `@opencoven/cave-client` | Explicit owner-local Cave discovery, constrained client operations, and reviewed Cave contract fixtures |
| `packages/coven` | `@opencoven/coven-client` | Explicit owner-local Coven discovery plus constrained health transports |
| `packages/sdk` | `@opencoven/sdk` | Optional Cave/Coven coordination without merging source-system identity or errors |
| `packages/cli` | `@opencoven/dev-cli` | Sole owner of the `opencoven` binary; help/version are implemented while operational scope is being decided |

## Runtime ownership and import purity

Importing any public package performs no discovery, credential lookup, network,
filesystem, process, socket, or daemon I/O.

Cave and Coven both offer explicit owner-local runtime discovery. Those
functions perform I/O only when called and require reviewed platform security
providers where Node cannot prove filesystem or connected-peer ownership.
Callers can still construct Cave clients with narrow custom transports.

Cave and Coven models, transports, authorities, and normalized errors remain
distinct. The coordination package composes them without pretending they share
one endpoint, credential, or failure model.

## Choosing a package

| Need | Package |
| --- | --- |
| Shared errors, compatibility/discovery contracts, operation controls, or in-memory secrets | `@opencoven/sdk-core` |
| Explicit Cave discovery, Cave health, familiar operations, or reviewed Cave contract fixtures | `@opencoven/cave-client` |
| Explicit Coven discovery and owner-local daemon health | `@opencoven/coven-client` |
| Optional Cave/Coven coordination | `@opencoven/sdk` |
| Deterministic help/version output from the global binary | `@opencoven/dev-cli` |

## Explicit Cave discovery

`@opencoven/cave-client` can securely read the fixed owner-local Client v1
record and negotiate compatibility before returning a client:

```ts
import { createDiscoveredCaveClient } from '@opencoven/cave-client';

const cave = await createDiscoveredCaveClient({ timeoutMs: 2_000 });
await cave.health({ timeoutMs: 2_000 });
```

Discovery checks only the reviewed `COVEN_CAVE_HOME`, `COVEN_HOME/cave`, and
owner-home fallback locations. It rejects symlinks, replacement races, foreign
ownership, unsafe modes, oversized or malformed records, stale PIDs, and
non-loopback endpoints. Windows callers must inject a reviewed filesystem trust
provider. The initial health request is fixed to the Client v1 route, sends no
credentials, follows no redirects, and shares the discovery deadline. The
returned client is bound to the negotiated Cave instance ID.

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

For directly constructed clients, the SDK does not own the URL, authentication,
retry, or fetch policy. Callers may provide cancellation and an optional
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
packages and verified locally. The Cave fixture provenance manifest pins
`OpenCoven/coven-cave` commit
`e2b5b9d10d8498895ba9ff39ce6185f4ed873b57`, producer paths, and SHA-256.
Refresh fixture bytes with
`pnpm sync:contracts -- --cave-root <path> --coven-root <path>` before running
the offline contract verifier. Explicitly prove a checkout is at the pinned
producer commit and byte-identical with
`pnpm verify:cave-authority -- --cave-root <path>`. No authority source tree is
imported at runtime, and packed-package verification compares all three
vendored Cave contract artifacts byte for byte.

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

## Merged branch cleanup

GitHub automatically deletes future merged PR branches in this repository. For
existing branches or attached local worktrees, run the guarded cleanup from a
different clean checkout:

```bash
pnpm cleanup:merged -- --branch <branch> --pr <number> --dry-run
pnpm cleanup:merged -- --branch <branch> --pr <number> --delete-remote
```

The command verifies the exact merged PR and recorded head commit, confirms its
merge commit is on the remote base branch, refuses dirty or locked worktrees and
changed remote branches, and then removes only the named worktree and branch.
This supports squash merges even when the base advanced before merge. Local and
remote ref deletion use expected commit IDs to reject concurrent changes.
Remote deletion is opt-in.

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
