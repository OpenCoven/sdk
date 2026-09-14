# @opencoven/coven-client

A constrained, owner-local Coven client. Importing the package performs
no filesystem, process, network, socket, or daemon I/O. Discovery, health, and
policy and automation capability requests happen only through explicit runtime calls.

The supported root API, pre-1.0 compatibility rules, and deprecation process
are documented in the repository
[compatibility policy](https://github.com/OpenCoven/sdk/blob/main/COMPATIBILITY.md)
and [support policy](https://github.com/OpenCoven/sdk/blob/main/SUPPORT.md).

## Shipped surface

- `discoverCovenEndpoint(options)` resolves the owner-local daemon endpoint
  only when called.
- `createDiscoveredCovenClient(...)` wraps that discovery with a health-only
  `CovenClient`.
- `createCovenUnixTransport(...)` and `createCovenWindowsTransport(...)`
  expose the exact reviewed built-in transports for the authenticated local
  daemon health contract.
- `createCovenClient(...)` preserves caller-supplied transports, while
  `COVEN_DAEMON_PROTOCOL` exports the exact reviewed daemon protocol string.
- `createCovenSessionPolicyClient(...)` is a separate, explicitly injected
  discovery/refusal-only policy consumer. It does not extend `CovenClient`,
  the built-in health transports, or the unified SDK client.
- `createCovenSessionPolicyUnixTransport(...)` is the opt-in real Unix policy
  transport with mandatory connected-peer security and only the two fixed
  policy routes. Windows policy transport is explicitly unsupported.
- `createCovenAutomationsClient(...)` reads the advertised Automations v1
  negotiation profile, compatibility definitions, routine health and run history.
  `createCovenAutomationsUnixTransport(...)` supplies authenticated Unix
  capability GET and allowlisted read-action POST requests; neither extends the
  health client.

## Automations phase 1: capability discovery, definition, health and run-history reads

Import `createCovenAutomationsClient` and `createCovenAutomationsUnixTransport`
directly from `@opencoven/coven-client`. Explicitly discover an endpoint, then
provide the same reviewed native Unix `peerIdentity` security adapter required
by the health transport:

```ts
const transport = createCovenAutomationsUnixTransport(endpoint, {
  security: { platform: 'unix', peerIdentity },
});
const automations = createCovenAutomationsClient({ transport });
const advertised = await automations.capabilities({ timeoutMs: 5_000 });
if (advertised.status === 'available') {
  console.log(advertised.variantNegotiation.supported);
}
```

The same standalone client supports definition reads:

```ts
const definitions = await automations.list(
  { includeTombstoned: false },
  { timeoutMs: 5_000 },
);
for (const routine of definitions.routines) {
  console.log(routine.id, definitions.revisionById[routine.id]);
}
const definition = await automations.get('morning', { timeoutMs: 5_000 });
if (definition.routine !== null) {
  console.log(definition.routine.status, definition.revision, definition.tombstonedAt);
}
```

These methods consume the producer's **executable compatibility** `RoutineDefinition`
(numeric `schemaVersion: 1`), not the normative rich `AutomationDefinition`.
`list()` defaults to excluding tombstones; `get()` includes a tombstoned definition
if it exists and returns `{ routine: null }` if it does not. Returned revision and
tombstone maps are checked against the returned routine IDs. Routine fields are
decoded for read interoperability, not revalidated as an executable schedule or
accepted authority.

Each read refreshes the capability advertisement and requires its exact action:
`coven.automations.definition.list.v1` or
`coven.automations.definition.get.v1`, `coven.automations.health`, or `coven.automations.runs`.
Missing/planned/unnegotiated profiles or
missing action names fail with `capability_unsupported` without posting an action.
Custom capability-only transports remain compatible; reads without the optional
`readDefinitions` hook fail with `unsupported_operation`.

The built-in Unix transport sends only these four allowlisted JSON actions to
`POST /api/v1/actions`. It authenticates each connection, including the separate
capability request, under one client deadline/cancellation scope. It cannot send
mutations through this hook. IDs are trimmed as the producer does; the SDK
additionally rejects malformed Unicode and IDs over 4,096 UTF-8 bytes. Responses
use the existing strict 16 KiB / 16-level JSON bound (including duplicate-key and
malformed-Unicode rejection). Larger catalogs fail closed, not partially; this
producer list action has no pagination contract. Canonical action rejection
becomes `action_rejected`, while malformed/crossed responses become
`invalid_response`; daemon rejection reasons and payloads are not copied into
errors. Capability advertisement and transport authentication do not establish
receipt authenticity or runtime authority.

Definition-read source authority is Coven
[`c56c2e2f10329c05df9273ac48914cf6b7ebb410`](https://github.com/OpenCoven/coven/tree/c56c2e2f10329c05df9273ac48914cf6b7ebb410):
[`api.rs`](https://github.com/OpenCoven/coven/blob/c56c2e2f10329c05df9273ac48914cf6b7ebb410/crates/coven-cli/src/api.rs)
routes `POST /actions` after API-version normalization;
[`control_plane.rs`](https://github.com/OpenCoven/coven/blob/c56c2e2f10329c05df9273ac48914cf6b7ebb410/crates/coven-cli/src/control_plane.rs)
advertises and dispatches these exact read actions, emits `ControlActionResponse`
with `event.kind: "automations.changed"` even for reads, and defines
`automation_list_payload` / `automation_get_payload`;
[`definition.rs`](https://github.com/OpenCoven/coven/blob/c56c2e2f10329c05df9273ac48914cf6b7ebb410/crates/coven-cli/src/automations/definition.rs)
owns the compatibility routine fields. No GET definition routes, normative
command-envelope adaptation, pagination, changefeed emission, or certification
are inferred from the schemas in `spec/coven-automations/v1`. Existing artifact
pins are unchanged. Individual run reads, occurrences, receipt reads/verification,
subscriptions and authority-bearing phases remain separate #80 work.

### Routine health

```ts
const { health } = await automations.health('morning', { timeoutMs: 5_000 });
console.log(health.nextDueAt, health.currentAttempt, health.quarantinedAt);
```

`health(id)` reads the exact `coven.automations.health` action (no `.v1`
suffix), returning `{ health }` from the canonical completed event payload.
All timestamp, lease, stale-reason, retry and quarantine string fields retain
explicit `null` values; `currentAttempt` is a nullable positive safe integer.
Failure/exhaustion counters are nonnegative safe integers and `maxAttempts` is
1–255. The returned `automationId` must match the trimmed requested ID.
Missing routines produce sanitized `action_rejected`, not an invented null result.
Health is store-derived diagnostic data, not execution or receipt authority.
Custom transports use the existing optional `readDefinitions` hook, whose
historical name now covers all four explicitly allowlisted read actions.

Health source authority was independently read from Coven
[`b3b2d043a4ee586ccbf25ef6aad21db8a1171a54`](https://github.com/OpenCoven/coven/tree/b3b2d043a4ee586ccbf25ef6aad21db8a1171a54):
[`api_routes.rs`](https://github.com/OpenCoven/coven/blob/b3b2d043a4ee586ccbf25ef6aad21db8a1171a54/crates/coven-cli/src/api_routes.rs)
normalizes `/api/v1/actions`;
[`control_plane.rs`](https://github.com/OpenCoven/coven/blob/b3b2d043a4ee586ccbf25ef6aad21db8a1171a54/crates/coven-cli/src/control_plane.rs)
advertises and dispatches the health action, and `automation_health_payload`
explicitly serializes its camelCase keys beneath `event.payload.health`;
[`automations/health.rs`](https://github.com/OpenCoven/coven/blob/b3b2d043a4ee586ccbf25ef6aad21db8a1171a54/crates/coven-cli/src/automations/health.rs)
owns the store-derived `RoutineHealth` values. No new route or mutation is enabled.

### Run history

```ts
const { runs } = await automations.runs('morning', { limit: 10 }, { timeoutMs: 5_000 });
for (const run of runs) {
  console.log(run.id, run.status, run.attempts, run.cancellation);
}
```

`runs(id, query?, operationOptions?)` posts the exact `coven.automations.runs`
action (no `.v1` suffix) and returns `{ runs }` from the completed event payload.
`limit` defaults to 20; the SDK accepts only safe integers from 1 through 100
rather than relying on the producer's fallback/clamping behavior. Runs are
newest-first (`started_at DESC`); tied timestamps have no promised order.
Unknown automation IDs return an empty history. There is no cursor, total,
truncation indicator, individual-run lookup, or all-history guarantee.

The compatibility projection includes nullable runtime/session/output/receipt
references, opaque `logJson` text, nested attempts ordered by attempt number,
and an optional cancellation projection (with absent, not null, optional fields).
The SDK checks requested automation IDs, distinct run/attempt/adoption IDs,
run/occurrence correlations, safe integer bounds and producer attempt/retry
enums and predecessor metadata. Legacy runs can have no occurrence or attempts.
Run status and stored timestamp strings are retained without inventing enums or
timestamp normalization. **This action does not serialize automation revision,
definition digest, timeout or authority profile**, even though some are stored
internally; the SDK neither synthesizes nor certifies them.

The existing authenticated connection, fresh exact-action capability check,
shared deadline/abort scope, strict JSON parsing, and 16 KiB response cap apply.
Large logs/history may exceed that cap even for `limit: 1`; they fail closed
without partial results. Use a smaller limit where possible. The producer reads
runs, attempts and cancellations separately, so this API does not promise an
atomic snapshot. Neither receipt references, cancellation records nor capability
policy labels authenticate receipts or authorize execution.

Run-history source authority was independently read at Coven
[`4e35dd4c99013159fcee4c1ab2f183accdf7a5f8`](https://github.com/OpenCoven/coven/tree/4e35dd4c99013159fcee4c1ab2f183accdf7a5f8):
[`control_plane.rs`](https://github.com/OpenCoven/coven/blob/4e35dd4c99013159fcee4c1ab2f183accdf7a5f8/crates/coven-cli/src/control_plane.rs)
advertises/dispatches `coven.automations.runs` and `automation_runs_payload`
serializes the exact compatibility shape;
[`automations/runs.rs`](https://github.com/OpenCoven/coven/blob/4e35dd4c99013159fcee4c1ab2f183accdf7a5f8/crates/coven-cli/src/automations/runs.rs)
defines the bounded run/attempt queries and attempt constraints;
[`automations/cancellation.rs`](https://github.com/OpenCoven/coven/blob/4e35dd4c99013159fcee4c1ab2f183accdf7a5f8/crates/coven-cli/src/automations/cancellation.rs)
defines `cancellation_for_run` and requester/status fields;
[`api.rs`](https://github.com/OpenCoven/coven/blob/4e35dd4c99013159fcee4c1ab2f183accdf7a5f8/crates/coven-cli/src/api.rs)
dispatches actions and separately gates receipt access to owner-local IPC.
Occurrence and receipt actions are separate producer contracts and are **not**
enabled by this milestone. No unrelated conformance artifact pins change.

`capabilities()` sends only `GET /api/v1/capabilities`. It reads the uniquely identified
`coven.automations` catalog entry, preserves supported, experimental and refused
variants separately, and accepts only profile version 1,
`coven.automations.v1`. Missing advertisements, planned capabilities, and older
entries without negotiation profiles return explicit `unavailable` reasons.
Malformed/duplicate entries, incompatible profiles, invalid UTF-8/JSON,
oversized bodies and non-200 HTTP responses fail with `CovenClientError`;
an HTTP failure is **not** projected as absence. Errors do not retain response
bodies or provider error causes. Unknown advertised variant strings are data,
not SDK execution support; experimental entries are not implicitly opted into.

The built-in transport enforces current-UID, socket permissions, connected-peer
authentication and post-connect identity checks before writing, with no retries
or redirects. It bounds headers to 64 KiB and response bodies to 16 KiB,
including error bodies. A five-second default operation deadline covers
endpoint inspection as well as I/O; direct transport calls are capped at five
minutes. Cancellation destroys active sockets. Windows has no automation
transport factory yet and is rejected by the Unix factory. Injected
`CovenAutomationsTransport` implementations must enforce equivalent trust,
framing and operation limits and return raw response bytes.

**Capability provenance:** this read surface follows Coven commit
[`c56c2e2f10329c05df9273ac48914cf6b7ebb410`](https://github.com/OpenCoven/coven/tree/c56c2e2f10329c05df9273ac48914cf6b7ebb410):
[`control_plane.rs`](https://github.com/OpenCoven/coven/blob/c56c2e2f10329c05df9273ac48914cf6b7ebb410/crates/coven-cli/src/control_plane.rs)
defines `CapabilityCatalog` and the Automations entry;
[`capability_negotiation.rs`](https://github.com/OpenCoven/coven/blob/c56c2e2f10329c05df9273ac48914cf6b7ebb410/crates/coven-cli/src/automations/capability_negotiation.rs)
defines the serialized profile;
[`api.rs`'s `routes_control_capabilities_discovery_to_json` test](https://github.com/OpenCoven/coven/blob/c56c2e2f10329c05df9273ac48914cf6b7ebb410/crates/coven-cli/src/api.rs#L20489)
binds the actual GET response to packaged
[`capabilities.json`](https://github.com/OpenCoven/coven/blob/c56c2e2f10329c05df9273ac48914cf6b7ebb410/spec/coven-automations/v1/capabilities.json).
SDK tests use synthetic contract-shaped responses, not a new certified artifact.
The earlier immutable artifact canary pin remains unchanged.

This is a focused part of [SDK #80](https://github.com/OpenCoven/sdk/issues/80),
not its completion. A local authenticated channel and an advertised capability
are **not receipt authentication, execution authorization, or certification**.
No individual-run/receipt retrieval, receipt verification, subscription,
mutation, or positive authority acceptance is implemented here. Producer rich
execution (#1054), trust (#857), and certification (#858) remain separate.
The unified `@opencoven/sdk` stays health-only.

## Session-policy admission v1 (refusal only)

Depend directly on **`@opencoven/coven-client`** and import these APIs from its
supported package root, not from a workspace source path or the private CLI.
This is one of the SDK's four release-inventory packages. Like the other
release packages, its source manifest remains private behind the repository's
pre-release publishing gates; this does not make it a CLI-only workspace API.
`@opencoven/sdk` remains the optional health coordinator and does not implicitly
create, activate, or re-export the policy client.

The authoritative contract is
[`coven.session-policy.v1`](https://github.com/OpenCoven/coven/blob/8ae022a70ce2506e0e3b4345b8e567fe94380ce5/spec/coven-session-policy/v1/README.md).
Its only restricted-launch outcome is a correlated **HTTP 409** response with
`decision: "rejected"`, `code: "enforcement_unavailable"`, and
`admission: "not_started"`. No production enforced adapter exists. This SDK
reports a schema-validated server refusal, not verified authority, a running
process constraint, a signature, or proof that other processes are stopped.
Fabricated accepted responses, session IDs, receipts, and effective grants
are rejected.

`CovenSessionPolicyClient` accepts an explicit `CovenSessionPolicyTransport`.
Use `createCovenSessionPolicyUnixTransport(endpoint, options)` for real Unix
IPC. It reuses the existing current-UID, non-symlink socket, permission,
connected-peer, and post-connect path-identity validation. It pauses the socket
until validation completes, then sends one fixed request and destroys the
socket on completion, cancellation, or failure. A reviewed native
`security: { platform: 'unix', peerIdentity }` adapter is still mandatory;
the SDK does not invent peer credentials. Windows endpoints fail with
`unsupported_platform`; no Windows policy factory is exposed.

There is no automatic endpoint discovery. Call `discoverCovenEndpoint()`
explicitly if needed, then opt into the policy factory separately. Do not
adapt the health transport, treat health capabilities as approval, or replace
peer authentication with path or discovery metadata. Construction performs no
I/O; client methods and direct transport requests perform I/O only when called.

The transport's discriminated request union contains exactly two routes:
`GET /api/v1/session-policy` and `POST /api/v1/sessions/restricted`. It exposes
no headers, credentials, arbitrary methods, or arbitrary paths. The adapter
must honor `OperationContext.signal` and `deadline`, enforce the supplied
16 KiB response limit while reading (including HTTP error bodies), and return
the **raw JSON `Uint8Array` plus numeric HTTP status**. It must bound connection,
headers and framing, disable redirects and automatic retries, and never fall
back to legacy launch. The consumer independently checks body size and strict
JSON; already-parsed objects are not an acceptable substitute.

The built-in policy transport enforces those constraints independently: 2-second
connect and 5-second request timeouts, 64 KiB headers, 16 KiB response bodies,
and a total frame allocation bound. Its whole-operation deadline also covers
initial path inspection and connected-peer validation, defaults to five seconds
when no context deadline is supplied, and never exceeds five minutes. The
request union and body array must be frozen; mutable octets, unknown methods,
paths, headers, and altered limits are rejected before I/O. No transport option
can raise the fixed policy size limits. Optional `dependencies` expose the same
isolated socket/UID/stat test seams as the health transport.

Protected invocation workflows must stop on unavailable discovery **before any
prompt-bearing POST**. The SDK also exposes an explicit POST for separately
requested refusal correlation; it is not automatic continuation, fallback, or
permission to start a runtime.

```ts
import {
  createCovenSessionPolicyClient,
  createCovenSessionPolicyUnixTransport,
  isCovenSessionPolicyError,
  type CovenDiscoveredEndpoint,
  type CovenRestrictedLaunchRequest,
  type CovenUnixPeerIdentityAdapter,
} from '@opencoven/coven-client';

declare const endpoint: CovenDiscoveredEndpoint;
declare const nativeUnixPeerIdentity: CovenUnixPeerIdentityAdapter;
declare const request: CovenRestrictedLaunchRequest;
const policy = createCovenSessionPolicyClient({
  transport: createCovenSessionPolicyUnixTransport(endpoint, {
    security: { platform: 'unix', peerIdentity: nativeUnixPeerIdentity },
  }),
});

// Explicit availability metadata, never authorization; no supported profiles in v1.
const availability = await policy.discover({ timeoutMs: 5_000 });
console.log(availability.enforcement); // "unavailable": protected invocation stops here.
```

For a separately requested refusal-correlation probe, the low-level POST remains
available using the explicitly constructed client:

```ts
// Caller supplies lowercase canonical request/invocation UUIDs and an admission
// deadline, then serializes once. Do not retry or silently create new identities.
const body = new TextEncoder().encode(JSON.stringify(request));
try {
  const refusal = await policy.launchRestricted(body, { timeoutMs: 5_000 });
  console.log(refusal.decision); // Always "rejected", never a grant.
} catch (error) {
  if (!isCovenSessionPolicyError(error)) throw error;
  console.error(error.code, error.delivery);
}
```

`launchRestricted()` copies the supplied octets before parsing, freezes a
`readonly number[]` snapshot for transport, and binds the response to SHA-256
of that exact snapshot plus both canonical UUIDs. Transport implementations
send `Uint8Array.from(request.body)` once, without JSON reserialization.
Whitespace, escaping and Unicode representation intentionally affect the
digest. The SDK does not perform semantic JSON canonicalization, path
resolution, familiar lookup, credential lookup, or TypeScript authority
decisions. The canonical v1 harness wire IDs are exactly `codex`, `claude`,
`coven-code`, and `copilot`. The typed request and parser reject other IDs;
this mirrors the versioned server schema, not an independent backend/authority
allowlist. Every listed harness still has unavailable enforcement.

Callers such as Wand may use Swift `JSONEncoder.sortedKeys`; pass the resulting
frozen bytes unchanged. Sorted keys do not authorize normalization of slash
escaping, Unicode, whitespace, or trailing newlines before sending or binding.

Requests are bounded to 1 MiB and depth 16, with the contract's closed envelope,
field types and UTF-8 limits. Duplicate keys (including escaped equivalents),
invalid UTF-8, unpaired Unicode surrogates, unknown contract/profile revisions,
and malformed payloads fail closed. Discovery and refusal responses are
closed schemas; supported profiles or positive enforcement metadata do not
become permission. Admission expiry must be a safe integer strictly in the
future and at most five minutes away. It is **not a running-process lease**.
The deadline must use a plain signed integer JSON token; fractional or
exponential encodings are invalid even when their numeric value is integral.
Negative safe integers are structurally integers but already expired, so this
consumer rejects them locally without sending a request.

Both operations accept existing `OperationOptions` and constructor operation
defaults. Unlike legacy `health()`, the opt-in policy consumer defaults to a
five-second timeout, caps operations at five minutes, and further bounds a
launch by its admission deadline. Request preparation consumes the timeout
budget. Cancellation/deadlines are checked before dispatch and after response
handling; non-cooperative transports cannot make the client wait indefinitely
or turn a late reply into a refusal. Stopping underlying I/O still requires a
cooperative adapter.

`CovenSessionPolicyError` exposes allowlisted `normalized` metadata,
`code`, optional HTTP status and validated request correlation fields,
`retryable: false`, and `delivery`:
`not_attempted` means the transport was not called; `unknown` means it was
called but no valid correlated refusal was received. Neither error state
asserts `not_started`. Invalid request/response, unsupported contract/profile,
HTTP errors, transport failure, invalid options, cancellation, and timeout
have explicit codes, as does unsupported platform. HTTP errors do not expose raw server messages or details;
transport errors and cancellation do not retain sensitive causes. Observer
error metadata also declares retries disabled. There is no automatic
discovery, POST retry, redirect, or fallback in this consumer.

Positive runtime enforcement, reviewed backend tuples, grants, leases,
revocation, and lifecycle events require a separate future contract. They
cannot be added to this refusal-only revision as metadata.

### Shared conformance vectors

You can reproduce these vectors from Coven producer commit
`8ae022a70ce2506e0e3b4345b8e567fe94380ce5`.
`fixtures/session-policy-v1/manifest.provenance.json` pins that commit, the source
manifest path, and its SHA-256. This separate SDK provenance file records the
origin of the samples, not runtime enforcement or authority.

The authoritative server vectors are copied byte-for-byte into
`fixtures/session-policy-v1/{request,refusal,discovery,manifest}.json`.
The manifest fixes admission time at `1799999700000`. Its 421-byte request
includes one trailing LF and binds to
`sha256:c61bac56f84d1f3fddd5e70da35a7e8906f9bd4bac769b5d4ad61769dae83fdb`.
These historical fixed-time samples are for conformance, not live launch.
Response fixture files include LF for source hygiene; server HTTP response
bodies do not. Both response whitespace forms are valid, but request bytes must
never be trimmed or reserialized for binding.

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

The built-in health transports support only `GET /api/v1/health` for the exact
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
remain compatible. There is no default timeout and no automatic retry. Timeout
rejects promptly for non-cooperative transports, while stopping underlying
daemon I/O requires the transport to honor its context signal. Retry transient
`not_found`, `command_failed`, `connect_failure`, or `timeout` failures only
after the operator has started or repaired the local runtime; ownership,
endpoint safety, malformed config, and platform-security failures are
fail-closed configuration issues.

The owner-local Coven daemon contract does not use bearer tokens, API keys,
cookies, or credential files. This package neither discovers nor sends them.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
