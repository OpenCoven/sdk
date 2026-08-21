# @opencoven/coven-client

A constrained, owner-local Coven health client. Importing the package performs
no filesystem, process, network, socket, or daemon I/O. Discovery and health
checks happen only through explicit runtime calls.

## Discover and check health

`createDiscoveredCovenClient(options)` resolves the current daemon, verifies
that the supplied transport-security provider matches that endpoint's
platform, and returns the existing typed `CovenClient`. Discovery
prefers a non-empty `COVEN_HOME`: on Unix it derives
`<COVEN_HOME>/coven.sock` and reads `<COVEN_HOME>/daemon.json` when present; on
Windows the daemon metadata supplies the profile-specific pipe name. When
`COVEN_HOME` is empty or absent, discovery executes exactly
`coven config paths --json` with no shell, a bounded timeout/output buffer, and
a small allowlisted environment. The executable and argv are not caller
configurable; tests may replace only the injected `execFile` dependency.

```ts
import {
  createDiscoveredCovenClient,
  discoverCovenEndpoint,
  type CovenUnixPeerIdentityAdapter,
} from '@opencoven/coven-client';

declare const nativeUnixPeerIdentity: CovenUnixPeerIdentityAdapter;
const coven = await createDiscoveredCovenClient({
  transportSecurity: {
    platform: 'unix',
    peerIdentity: nativeUnixPeerIdentity,
  },
});

await coven.health({ timeoutMs: 5_000 });
```

The SDK intentionally does not bundle a peer-credential implementation.
The embedding CLI or runtime must inject a reviewed native provider for its
current platform. There is no pathname-only approximation, shell or `lsof`
fallback, private Node-internals fallback, or permissive default.

`discoverCovenEndpoint()` remains zero-config when an application only needs
to inspect the typed endpoint and its available owner/freshness metadata:

```ts
const endpoint = await discoverCovenEndpoint();
```

## Same-user IPC

The built-in transports support only `GET /api/v1/health` for the exact
`coven.daemon.v1` protocol. They do not expose arbitrary request methods,
frames, or socket handles.

- Unix endpoints must be normalized absolute paths. The transport uses
  `lstat`, rejects symlinks and non-sockets, requires the current effective UID
  and rejects group/world-writable modes. Because Node has no portable API for
  connected Unix peer identity, callers must provide a native
  `peerIdentity.inspectConnected(socket)` adapter through a discriminated
  `{ platform: 'unix' }` security provider. The adapter receives the exact live
  connected socket, not its pathname, and must derive the peer credentials
  from that socket. The transport compares the returned owner and device/inode
  identity to the current effective UID and the prevalidated endpoint, then
  separately revalidates the current path. Adapter errors, identity mismatch,
  and validation timeout fail closed.
- Windows endpoints must be canonical local `\\.\pipe\...` names. Node does
  not expose sufficient named-pipe ACL/owner inspection, so Windows callers
  must provide a native, PowerShell-free `ownership` adapter through a
  discriminated `{ platform: 'windows' }` security provider. The adapter
  validates the current owner before connection and the connected pipe
  identity afterward.

Direct transport construction uses the same discriminated security providers
as discovered clients:

```ts
import {
  createCovenUnixTransport,
  createCovenWindowsTransport,
  type CovenDiscoveredEndpoint,
  type CovenUnixPeerIdentityAdapter,
  type CovenWindowsPipeOwnershipAdapter,
} from '@opencoven/coven-client';

declare const unixEndpoint: CovenDiscoveredEndpoint;
declare const windowsEndpoint: CovenDiscoveredEndpoint;
declare const nativeUnixPeerIdentity: CovenUnixPeerIdentityAdapter;
declare const nativeWindowsPipeOwnership: CovenWindowsPipeOwnershipAdapter;

const unixTransport = createCovenUnixTransport(unixEndpoint, {
  security: {
    platform: 'unix',
    peerIdentity: nativeUnixPeerIdentity,
  },
});

const windowsTransport = createCovenWindowsTransport(windowsEndpoint, {
  security: {
    platform: 'windows',
    ownership: nativeWindowsPipeOwnership,
  },
});
```

Supplying the wrong platform provider, omitting `security`, using a bare
Windows `ownership` property, or returning unverifiable connected-peer data
is rejected rather than downgraded to pathname validation.

Connect and request timeouts, HTTP headers, response bodies, and framing are
bounded. The health response must contain boolean `sessions`, `events`, and
`structuredErrors` capabilities; `eventCursor` remains optional for source
compatibility. A health operation deadline covers ownership/path inspection,
connected-peer revalidation, connect, write, read, and socket cleanup.

## Errors

Discovery and built-in transport failures use `CovenIpcError` with stable
codes: `not_found`, `command_failed`, `malformed_config`, `unsafe_endpoint`,
`owner_mismatch`, `connect_failure`, `timeout`, `body_limit`, `frame_limit`,
and `invalid_response`. Diagnostics contain only allowlisted scalar metadata,
such as phase, exit status, signal, and byte counts. Command output,
filesystem contents, credentials, and socket handles are never copied into
public errors.

Daemon error envelopes remain structured on `CovenClientError.daemon` instead
of being flattened to strings. Their JSON-compatible details are copied
through bounded, cycle- and accessor-safe validation; sensitive field names,
excessive depth, or excessive structured size fail closed as
`invalid_response`. Use `isCovenClientError(error)` and `isCovenIpcError(error)`
when errors may cross bundles or duplicate package installations.

`health()` accepts an optional signal, timeout, and lifecycle observer.
Constructor operation defaults remain additive, and zero-argument transports
remain compatible. There is no default timeout. Timeout rejects promptly for
non-cooperative transports, while stopping underlying daemon I/O requires the
transport to honor its context signal.

The owner-local Coven daemon contract does not use bearer tokens, API keys,
cookies, or credential files. This package neither discovers nor sends them.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
