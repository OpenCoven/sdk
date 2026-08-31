# OpenCoven TypeScript SDK

> [!WARNING]
> **Experimental — not ready for public consumption.** This SDK is under active
> development, has not completed its first-release security review, and may
> change without notice. Do not use it for production workloads or with
> production credentials.

This workspace contains four experimental TypeScript SDK release packages and
a private developer CLI workspace for OpenCoven Phase 1b clients, transports,
compatibility contracts, runtime-only Cave discovery and pairing, explicit
Coven daemon health, coordinated health reporting, and shared protocol
infrastructure.

## Release status

This source repository is public, but all workspace packages are explicitly
marked private, are not published, and have standard publishing blocked. The
0.1 release inventory contains only `@opencoven/sdk-core`,
`@opencoven/cave-client`, `@opencoven/coven-client`, and `@opencoven/sdk`.
`@opencoven/dev-cli` remains private and is not packed, versioned with, or
published beside that group. Standard publishing also requires
`OPENCOVEN_RELEASE_AUTHORIZATION=publish`; remove or change these gates only as
part of an intentional release process. The 0.1 native Chat/real-authority
conformance release matrix is separately frozen to `darwin-arm64`,
`linux-x64`, and `win32-x64`; see [SUPPORT.md](SUPPORT.md) for the distinction
between Node runtime support and this release gate.

- [Roadmap](docs/ROADMAP.md)
- [0.1 read-only release design](docs/superpowers/specs/2026-08-22-sdk-0.1-read-only-release-design.md)
- [0.1 dependency-ordered delivery program](docs/superpowers/plans/2026-08-22-sdk-0.1-delivery-program.md)
- [GitHub delivery program](https://github.com/OpenCoven/sdk/issues/31)
- [Support policy](SUPPORT.md)
- [Compatibility and deprecation policy](COMPATIBILITY.md)
- [Security policy](SECURITY.md)
- [Release process](RELEASING.md)
- [Contributing](CONTRIBUTING.md)

## Current delivery program

The first public release is intentionally scoped as a secure **read-only**
protocol release. A packed consumer must be able to discover Cave and Coven,
negotiate compatibility, pair through user consent, retain credentials in
native custody, validate live IPC identity, and read canonical state.

SDK [#36](https://github.com/OpenCoven/sdk/issues/36) merged through PR #55 at
`d7f9e69378d6136c2771f60b4c57d7beeaa74f6a`. SDK
[#37](https://github.com/OpenCoven/sdk/issues/37) resolves the next boundary by
deferring the CLI from the 0.1 release group and assigning Phase 1 native trust
adapters to Chat's Tauri layer. Chat
[#27](https://github.com/OpenCoven/chat/issues/27) is closed after landing the
native integration, and
[OpenCoven/chat#30](https://github.com/OpenCoven/chat/pull/30) produced the first packed
real-authority record on `darwin-arm64`. SDK
[#38](https://github.com/OpenCoven/sdk/issues/38) remains open for the required
`linux-x64` and `win32-x64` records on the merged producer path from
[OpenCoven/coven-cave#5044](https://github.com/OpenCoven/coven-cave/pull/5044),
which closed
[OpenCoven/coven-cave#4996](https://github.com/OpenCoven/coven-cave/issues/4996).

Message sending, streaming, attachments, task handoffs, GitHub mutations, and
offline mutation queues are explicitly deferred to separately reviewed
post-release authority milestones. The roadmap and issue program above are the
current plan of record; older Phase 0 plans remain historical evidence rather
than the active release checklist.

| Path | Package | 0.1 status | Current purpose |
| --- | --- | --- | --- |
| `packages/core` | `@opencoven/sdk-core` | Release inventory | Transport-neutral errors, compatibility/discovery contracts, operation controls, bounded pagination, allowlisted diagnostics, non-secret profiles, and in-memory secret abstractions |
| `packages/cave` | `@opencoven/cave-client` | Release inventory | Constrained Cave client, runtime discovery/pairing, canonical reads, legacy familiar extensions, and reviewed contract fixtures |
| `packages/coven` | `@opencoven/coven-client` | Release inventory | Constrained Coven discovery and health with explicit native transport-security providers |
| `packages/sdk` | `@opencoven/sdk` | Release inventory | Optional Cave/Coven coordination without merging source-system identity or errors |
| `packages/cli` | `@opencoven/dev-cli` | Private workspace only | Source-tested `opencoven` command implementation, native keyring integration, and fail-closed native trust injection points |

## Runtime ownership and import purity

The SDK performs no discovery, credential lookup, network, filesystem, or
daemon I/O at import time. Cave pairing/discovery is runtime-only and opt-in;
low-level Cave and Coven models, transports, and normalized errors remain
distinct. Coven discovery and owner-local health transport factories also
perform I/O only when called and require reviewed platform-security providers
where Node cannot prove connected-peer or pipe identity. The coordination
package composes both systems without pretending they share one endpoint,
credential, or failure model.

## Choosing a package

| Need | Package |
| --- | --- |
| Shared errors, compatibility/discovery contracts, operation controls, bounded pagination, allowlisted diagnostics, non-secret profiles, or in-memory secrets | `@opencoven/sdk-core` |
| Cave health, runtime pairing/discovery, canonical reads, legacy familiar extensions, or reviewed contract fixtures | `@opencoven/cave-client` |
| Explicit Coven discovery and owner-local daemon health | `@opencoven/coven-client` |
| Optional Cave/Coven coordination | `@opencoven/sdk` |
| Runtime diagnostics, discovery, pairing, credential status, and health commands for repository development only | Private `@opencoven/dev-cli` workspace |

## Private developer CLI contract

`@opencoven/dev-cli` implements these experimental commands in the workspace:

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
On Windows, the default CLI also fails Cave `discover`, `doctor`, `pair`,
`status`, and `forget` closed with `platform_security_unavailable` until a
reviewed native path ownership/ACL validator is injected through
`CliRuntime.cave.discovery.dependencies.windowsPathTrust`; the CLI never
trusts discovery metadata, file ownership metadata alone, or shell output.
During an active credential commit, `cave status` surfaces a retryable
`credential_update_in_progress`/`disconnected` result instead of clearing the
pending credential.

The CLI is deliberately excluded from 0.1 release artifacts because its
default Windows Cave path validation and Coven peer/pipe validation still need
native adapters. Phase 1 production ownership for those adapters is
OpenCoven Chat's Tauri layer. A future standalone CLI release requires a
separate reviewed native distribution design and packed-binary validation.

## Caller-supplied Cave transports

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
The discovered exchange brackets the single-use request with unauthenticated
health proofs and stores the credential only when the Cave `instanceId`
remains stable. A failed post-exchange proof is terminal for that session and
requires a new pairing.
If a second reader observes a staged credential write mid-commit, authenticated
calls fail locally with retryable `credential_update_in_progress` rather than
deleting the credential that is still being committed.

When you inject `credentials` into `new CaveClient({ transport, credentials })`,
the transport must satisfy `CaveCredentialPersistingTransport` and return the
non-secret `authorityBinding` metadata from `pairingExchange()`. The public
binding carries the Cave instance ID, endpoint URL, an opaque record identity,
device/inode, and freshness, without exposing the canonical discovery-record
path directly. Discovered authenticated calls prove the stored instance ID
through an unauthenticated health request before attaching the bearer.
That separate preflight detects observable restarts but cannot atomically bind
the later HTTP request to the proven process in legacy discovery v1. Final 0.1
security disposition and real-authority/packed-consumer conformance evidence
remain gated on the merged producer path from
[OpenCoven/coven-cave#5044](https://github.com/OpenCoven/coven-cave/pull/5044),
which closed
[OpenCoven/coven-cave#4996](https://github.com/OpenCoven/coven-cave/issues/4996).

## Managed native Cave credentials

Webview hosts can use `createManagedCaveClient()` with a
`CaveManagedNativeTransport` implemented by their native IPC layer. Pairing
secrets and bearers remain behind the native boundary; JavaScript receives only
bounded opaque handles, non-secret authority binding, credential metadata, and
raw non-secret Client v1 envelopes for authoritative SDK parsing. Exchange is
staged and committed only after SDK validation, with exact-handle discard on
validation failure, timeout, abort, or late completion.

The adapter has narrow typed methods for health, pairing, credential state and
forget, familiars, and all five canonical reads. It is not a generic fetch
bridge. Native payloads are rejected if they contain accessors, cycles,
non-JSON values, excessive complexity, or secret- or bearer-bearing fields.
Native bridge rejections are sanitized to a generic availability failure;
structured protocol errors travel through non-2xx raw Client v1 responses.
The packed `cave-managed-native` example verifies pairing, native commit,
credential status, canonical reads, errors, observers, and serialized state
without exposing either secret sentinel.

Tauri-style browser webviews can instead import the browser-safe
`@opencoven/cave-client/managed` subpath. Its
`CaveManagedCredentialTransport` keeps pairing secrets and bearers native while
returning only validated request metadata, pairing status, credential metadata,
and canonical envelopes to the SDK. It also accepts an owner-checked
`CaveManagedDiscoverySource`, so discovery parsing never requires filesystem
access in the webview.

## Cave canonical reads

`CaveClient` ships five one-page methods:

- `listFamiliars()`
- `listProjects()`
- `listConversations()`
- `getConversation()`
- `listConversationMessages()`

It also ships four bounded iterators: `iterateFamiliars()`,
`iterateProjects()`, `iterateConversations()`, and
`iterateConversationMessages()`. There is no detail iterator for
`getConversation()`.

List limits default to exactly `50`, accept only safe integers from `1` through
`100`, and reject invalid values rather than clamping. Cursors are opaque,
strict canonical base64url strings bounded to 512 characters; the SDK validates
their spelling without semantically decoding them. Iterators require either a
positive safe-integer `maxPages` or a caller-owned `AbortSignal`. They are lazy,
request one page at a time, and perform no prefetch, automatic retry, or
implicit whole-corpus walk.

The discovered client uses deterministic `GET` routes:

```text
/api/client/v1/familiars?limit=<limit>[&cursor=<cursor>]
/api/client/v1/projects?limit=<limit>[&cursor=<cursor>]
/api/client/v1/conversations?limit=<limit>[&cursor=<cursor>]
/api/client/v1/conversations/<encodeURIComponent(id)>
/api/client/v1/conversations/<encodeURIComponent(id)>/messages?limit=<limit>[&cursor=<cursor>]
```

Query order is always `limit` then optional `cursor`, and each conversation ID
is encoded as one path segment. Each discovered canonical request first proves
the stored Cave `instanceId` through an unauthenticated health request and then
sends the authenticated request. That is defense in depth, not atomic binding,
for legacy discovery v1. `OpenCoven/coven-cave#4996` closed through
[OpenCoven/coven-cave#5044](https://github.com/OpenCoven/coven-cave/pull/5044);
the remaining gate is real-authority/packed-consumer conformance evidence.

Success and explicit error envelopes require `apiVersion: "1.0"`,
`minimumClientVersion`, `capabilities`, and nonempty `operations`. Explicit Cave
errors remain explicit. Conversation `exitCode` is optional and nullable,
message `parentId` is required and nullable, and consumer-visible count fields
are strict nonnegative safe integers.

`reconcile_required` means the caller must discard derived paging state and
reload canonical state; it is never automatically retried. This is especially
important for message branch drift with
`details.reason: "resume_from_canonical_state"`. The legacy `familiars()`,
`familiarContract()`, and `familiarAnalytics()` methods remain a separate
compatible extension surface.

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
Retry only transient `timeout`, `not_found`, `connect_failure`,
`service_unavailable`, or `rate_limited` failures after the operator confirms
the local runtime is ready. Version, authority-binding, ownership,
secure-store, and platform-security errors require repair before rerunning.

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
`4adc97b1bdafd1012ce4c66de598e82f49329f79`, producer paths, and SHA-256.
Refresh fixture bytes with
`pnpm sync:contracts -- --cave-root <path> --coven-root <path>` before running
the offline contract verifier. Explicitly prove a checkout is at the pinned
producer commit and byte-identical with
`pnpm verify:cave-authority -- --cave-root <path>`. No authority source tree is
imported at runtime, and packed-package verification compares all three
vendored Cave contract artifacts byte for byte. Packed tests also install the
generated tarballs and verify canonical-read methods, iterators, and types
through package-root imports without source-checkout or deep-import fallback.

## Validation

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
node scripts/verify-contracts.mjs
node scripts/verify-package.mjs
pnpm verify:development-release-configuration
pnpm test:coverage
pnpm test:stress
pnpm lint
```

`corepack pnpm@10.34.0 verify` runs that canonical sequence after installation.
The remote evidence gate is separate and scopes the GitHub token to its single
command:

```bash
GH_TOKEN=... OPENCOVEN_GH_PATH="$(command -v gh)" \
  corepack pnpm@10.34.0 verify:release
```

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
