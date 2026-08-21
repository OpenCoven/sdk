# @opencoven/coven-client

A constrained, owner-local Coven health client. Importing the package performs
no filesystem, process, network, socket, or daemon I/O. Discovery and health
checks happen only through explicit runtime calls.

## Discover and check health

`createDiscoveredCovenClient()` resolves the current daemon, selects the
platform transport, and returns the existing typed `CovenClient`. Discovery
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
  type CovenUnixPeerIdentityAdapter,
} from '@opencoven/coven-client';

declare const nativeUnixPeerIdentity: CovenUnixPeerIdentityAdapter;
const coven = await createDiscoveredCovenClient({
  unix: { peerIdentity: nativeUnixPeerIdentity },
});

await coven.health({ timeoutMs: 5_000 });
```

Use `discoverCovenEndpoint()` separately when an application needs to inspect
the typed endpoint and its available owner/freshness metadata before creating a
transport.

## Same-user IPC

The built-in transports support only `GET /api/v1/health` for the exact
`coven.daemon.v1` protocol. They do not expose arbitrary request methods,
frames, or socket handles.

- Unix endpoints must be normalized absolute paths. The transport uses
  `lstat`, rejects symlinks and non-sockets, requires the current effective UID
  and rejects group/world-writable modes. Because Node has no portable API for
  connected Unix peer identity, callers must provide a native
  `peerIdentity.inspectConnected()` adapter. The transport compares that
  connected peer's owner and device/inode identity to the current effective
  UID and the prevalidated path, then separately revalidates the current path.
  Missing or failed peer identity inspection fails closed.
- Windows endpoints must be canonical local `\\.\pipe\...` names. Node does
  not expose sufficient named-pipe ACL/owner inspection, so Windows callers
  must provide a native, PowerShell-free `ownership` adapter. The adapter
  validates the current owner before connection and the connected pipe
  identity afterward.

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
