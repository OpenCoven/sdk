# @opencoven/coven-client

A constrained, owner-local Coven health client. Importing the package performs
no filesystem, process, network, socket, or daemon I/O. Discovery and health
checks happen only through explicit runtime calls.

## Discover and check health

`createDiscoveredCovenClient(options)` resolves the current daemon, verifies
that the supplied transport-security provider matches that endpoint's
platform, and returns the existing typed `CovenClient`. On Unix, a non-empty
`COVEN_HOME` directly selects `<COVEN_HOME>/coven.sock`. On Windows, including
when `COVEN_HOME` is set, discovery obtains the selected profile's authoritative
`state.daemon_ipc` from exact `coven config paths --json` output; it never
constructs a pipe name from the Unix convention or redirects through
`daemon.json.socket`.

CLI fallback requires an explicit `dependencies.resolveExecutable` provider.
The returned path is canonicalized and must be an absolute regular executable
named `coven` (`coven.exe` on Windows). Unix executables must be owned by the
current UID or root and must not be group/world writable. Windows discovery
also requires an injected `windowsFileTrust.validate()` ownership/trust
provider. The SDK then executes only the fixed `config paths --json` argv with
no shell, a bounded timeout/output buffer, and a small allowlisted environment.
Callers cannot supply an arbitrary command or argv.

```ts
import {
  createDiscoveredCovenClient,
  discoverCovenEndpoint,
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

The SDK intentionally does not bundle a peer-credential implementation.
The embedding CLI or runtime must inject a reviewed native provider for its
current platform. There is no pathname-only approximation, shell or `lsof`
fallback, private Node-internals fallback, or permissive default.
OpenCoven's Node CLI likewise ships no implicit adapter: it reports
`platform_security_unavailable` and marks Coven health unhealthy until the
embedding runtime injects a reviewed native provider. It never derives
connected-peer or connected-pipe identity from discovery metadata, filesystem
ownership, or shell commands.

`discoverCovenEndpoint()` can inspect the typed endpoint and its available
owner/freshness metadata. Unix `COVEN_HOME` discovery needs no executable
resolver; CLI-based and all Windows discovery must inject the trusted
executable collaborators described above:

```ts
const endpoint = await discoverCovenEndpoint({
  dependencies: {
    resolveExecutable: () => trustedCovenPath,
  },
});
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
  from that socket. It returns the actual peer `uid` with optional `gid` and
  `pid`; filesystem device/inode values are not peer credentials. The
  transport requires the peer UID to equal the current effective UID, then
  separately re-runs `lstat` and requires the pathname's device, inode, socket
  type, owner, and mode to match the pre-connect snapshot. Adapter errors,
  identity mismatch, and validation timeout fail closed.
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
Connected sockets are paused while peer/pipe and pathname validation runs; no
request is written and no response can resolve before validation succeeds.

Optional daemon metadata is first `lstat`-validated as a non-symlink,
owner-safe regular file, then read through a bounded file handle using at most
16 KiB plus one detection byte. Stat, open, read, and close share the discovery
deadline; FIFOs, devices, oversized files, and stalled operations fail closed.

## Errors

Discovery and built-in transport failures use `CovenIpcError` with stable
codes: `not_found`, `command_failed`, `malformed_config`, `unsafe_endpoint`,
`owner_mismatch`, `connect_failure`, `timeout`, `body_limit`, `frame_limit`,
and `invalid_response`. Diagnostics contain only allowlisted scalar metadata,
such as phase, exit status, signal, and byte counts. Command output,
filesystem contents, credentials, and socket handles are never copied into
public errors.

Daemon error envelopes remain structured on `CovenClientError.daemon` instead
of being flattened to strings. `code`, `message`, optional numeric `status`,
and optional `details` are preserved; safe additive fields are ignored. Details
are copied through bounded, cycle- and accessor-safe validation, while
sensitive field names, excessive depth, or excessive structured size fail
closed as `invalid_response`. Branded-error inspection reads only own data
descriptors and never invokes property getters. Use
`isCovenClientError(error)` and `isCovenIpcError(error)` when errors may cross
bundles or duplicate package installations.

`health()` accepts an optional signal, timeout, and lifecycle observer.
Constructor operation defaults remain additive, and zero-argument transports
remain compatible. There is no default timeout. Timeout rejects promptly for
non-cooperative transports, while stopping underlying daemon I/O requires the
transport to honor its context signal.

The owner-local Coven daemon contract does not use bearer tokens, API keys,
cookies, or credential files. This package neither discovers nor sends them.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
