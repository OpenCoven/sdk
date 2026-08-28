# SDK Encrypted Offline Reads and Advanced Tooling Design

**Status:** Implementation-ready design for
[OpenCoven/sdk#44](https://github.com/OpenCoven/sdk/issues/44); implementation
remains blocked by SDK #41 and the producer revision prerequisite below

**Date:** 2026-08-28

**Decision owner:** OpenCoven maintainers

## 1. Executive decision

OpenCoven should add offline access as an explicitly stale, encrypted,
replaceable read cache. It must not become another database, an authorization
source, or a mutation queue.

The chosen design has these properties:

1. Only the five reviewed Cave Client v1 reads can populate the cache:
   familiars, projects, conversations, one conversation, and one
   conversation's transcript pages.
2. Every cached entry is bound to a Cave instance ID, an authoritative
   producer revision, the exact normalized request, and cache schema version.
3. The native cache is one bounded AES-256-GCM archive replaced atomically.
   Every replacement generates a new 256-bit key and 96-bit nonce. The key is
   held only in an OS-keychain-backed key record, never beside the archive.
4. Live and offline reads use a new explicit read repository. `mode: "live"`
   never silently falls back; `mode: "offline"` performs no discovery,
   network, or authority I/O and always returns `source: "cache"` and
   `stale: true`.
5. Existing `CaveClient` methods remain live-only and source-compatible.
6. Canonical revisions must first become real producer output. The SDK must
   not synthesize revisions from timestamps, cursors, payload hashes, or local
   counters.
7. The CLI remains private unless a later, separate distribution decision
   approves it. Private source work may add the frozen grammar, completions,
   read commands, cache inspection/reset, and fixed scaffolds without changing
   the four-package public release inventory.
8. Browser code receives no filesystem capability, keychain record, AES key,
   nonce, or ciphertext. A reviewed native host owns persistence and exposes
   only narrow bounded calls.

## 2. Current-state constraints

This design builds on, and does not weaken, the current repository:

- `packages/cave/src/canonical-reads.ts` validates the five one-page canonical
  reads, but deliberately discards envelope `revision` metadata.
- `packages/cave/src/schemas.ts` has canonical DTOs but no revision-bearing
  read result.
- Cave's current Client v1 documentation says `revision` is defined but emitted
  by no route. SDK #36 also explicitly forbade inventing revision behavior.
- `packages/core/src/diagnostics.ts` creates an allowlisted version 1 report,
  permits at most 16 unique checks, and redacts before CLI rendering.
- `packages/core/src/profiles.ts` establishes the repository pattern for
  owner-private paths, bounded files, same-directory temporary files, file and
  directory synchronization, atomic rename, explicit corruption reset, and
  fail-closed Windows behavior.
- `packages/cave/src/managed.ts` and `managed-native.ts` establish the narrow
  native bridge pattern: secrets remain native, bridge outputs are bounded,
  hostile object graphs are rejected, and generic authenticated fetch is not
  exposed.
- `packages/cli/src/main.ts` currently duplicates command truth between
  `CLI_USAGE` and handwritten parsing.
- `packages/cli/src/output.ts` still accepts arbitrary scalar detail keys
  before recursive output sanitization. New diagnostic and cache output must
  move to field allowlists rather than extending that permissive pattern.
- `scripts/repository-metadata.mjs` defines four public packages and one
  private CLI workspace. `release.config.json` and Changesets contain only the
  four libraries.
- `SUPPORT.md` supports Node `>=24.18.0 <25`; the frozen native conformance
  matrix is `darwin-arm64`, `linux-x64`, and `win32-x64`.

SDK #39 is complete. SDK #41 is still open, all packages remain private, and
publishing remains locked. The #44 implementation sequence must not be used to
bypass the first-release review and provenance gates.

## 3. Scope

### 3.1 In scope

- authoritative revision metadata for all five Client v1 reads;
- revision-aware live read results without changing existing live-only
  methods;
- an encrypted native archive and a managed-native cache boundary;
- explicit live versus offline one-page read methods;
- deterministic supersession and late-response rejection;
- bounded retention, entries, decoded structure, and file size;
- automatic purge when a known Cave instance changes;
- explicit reset for corrupt, undecryptable, or unsupported cache state;
- cache diagnostics that expose only bounded status facts;
- a single CLI grammar source;
- static Bash, Zsh, Fish, and PowerShell completions generated from that
  grammar;
- three fixed scaffolds: `cave-read`, `coven-observer`, and `unified-status`;
- packed-package compile/run coverage for every scaffold;
- browser/native boundary documentation and conformance.

### 3.2 Out of scope

- offline send, stop, retry, stream, attachment upload, task, or GitHub action;
- a pending mutation, draft, outbox, replay log, conflict-free store, or cloud
  sync;
- cache-based authorization, scope validation, credential recovery, or
  revocation decisions;
- bearer tokens, pairing secrets, credential records, credential authority
  bindings, secret-store account names, idempotency keys, attachment bytes,
  action payloads, full event streams, or diagnostic archives in cache;
- arbitrary HTTP routes, arbitrary template URLs, plugin templates, hook
  scripts, package-manager execution, or shell execution;
- transparent live-to-cache fallback;
- browser `localStorage`, IndexedDB, Cache Storage, Service Workers, or Web
  Crypto as a persistence fallback;
- in-place migration of unreadable encrypted archives;
- making `@opencoven/dev-cli` public as part of implementation work.

The canonical `CaveConversation.pending` read field is allowed because it is
producer-owned resource state. It must not be repurposed into a local pending
mutation record.

## 4. Required delivery gates

The following gates are mandatory and ordered:

1. **First-release gate:** SDK #41 closes, or maintainers explicitly record a
   reviewed re-sequencing decision. Documentation may merge before this gate;
   #44 implementation PRs may not silently overtake it.
2. **Producer revision gate:** Cave emits and documents revisions for every
   canonical read, advertises the cross-cutting `revisions` capability, updates
   its fixture, and passes real-socket revision conformance.
3. **SDK contract gate:** the SDK imports the exact producer fixture and
   validates revision semantics before any persistent cache implementation
   merges.
4. **Native custody gate:** the Node reference adapter and Chat native adapter
   pass key-custody, interruption, permissions/ACL, and tamper tests on their
   approved targets.
5. **Security review gate:** exact final cache implementations receive a
   dedicated native-storage security review.
6. **CLI distribution gate:** a separate maintainer decision keeps the CLI
   private or authorizes public distribution. Source-tested private tooling
   does not count as a public CLI release.

## 5. Producer revision contract

### 5.1 Required envelope metadata

All five canonical success envelopes must include:

```ts
export interface CaveReadRevision {
  readonly token: string;
  readonly updatedAt: string;
}
```

Rules:

- `token` is opaque, non-empty UTF-8, and at most the existing contract limit
  of 128 characters.
- `updatedAt` is canonical UTC ISO 8601 with millisecond precision, exactly the
  form produced by `Date.prototype.toISOString()`.
- A token is scoped by `(instanceId, resourceKey)`. It is not globally
  comparable and is never authorization material.
- The same token must always carry the same `updatedAt`.
- A projected resource change must produce a different token and a strictly
  later `updatedAt`.
- Every page for the same unchanged resource uses the same revision.
- Unknown additive DTO fields still do not enter cache; the SDK caches only
  its validated public projection.

The resource key is:

```ts
type CaveRevisionResource =
  | { readonly kind: 'familiars' }
  | { readonly kind: 'projects' }
  | { readonly kind: 'conversations' }
  | { readonly kind: 'conversation'; readonly conversationId: string }
  | { readonly kind: 'transcript'; readonly conversationId: string };
```

`listConversationMessages()` uses `transcript`, not `message`, because one
revision describes the active canonical transcript branch for that
conversation.

### 5.2 Capability truth

The producer adds `revisions` as a cross-cutting capability owned by the five
read operations, in the same manner that `cursors` is cross-cutting. It does
not add a fake revision route.

The SDK may perform live reads against older authorities, but it must not
populate persistent cache unless:

- health and the read envelope advertise `revisions`;
- the exact read operation is advertised; and
- a valid revision is present.

Absence is `cache_not_supported`, not a synthetic local revision.

### 5.3 Revision comparison

For one `(instanceId, resourceKey)`:

| Current versus incoming | Decision |
| --- | --- |
| same token, same `updatedAt` | same revision; merge the exact page/record |
| same token, different `updatedAt` | malformed producer response |
| different token, later `updatedAt` | newer; remove every older entry for the resource, then store |
| different token, earlier `updatedAt` | late stale response; reject and keep current cache |
| different token, equal `updatedAt` | revision conflict; reject and require a fresh canonical read |

A rejected late response is not returned to the repository caller, because
doing so would regress a process that already observed newer canonical state.
It surfaces `cache_stale_response` with retryable `true`. An equal-time
conflict surfaces non-retryable `cache_revision_conflict`.

## 6. Package and runtime architecture

### 6.1 `@opencoven/cave-client`

The Cave package owns:

- `CaveReadRevision`, resource keys, normalized cache request keys, sourced
  read results, and cache errors;
- strict parsing of required revision metadata;
- `CaveReadRepository`, created from an authority-bound `CaveClient`;
- revision comparison and stale-response rejection;
- cache entry validation and resource allowlisting;
- the managed-native cache interface;
- a Node-only `@opencoven/cave-client/node-cache` subpath containing the
  reference encrypted file adapter.

The root package remains import-pure. The Node cache subpath may import
`node:crypto`, `node:fs`, `node:path`, and `node:os`, but opening the subpath
still performs no I/O until a method is called.

The Node entry point is:

```ts
export interface CaveNativeCacheKeyStore extends SecretStore {
  readonly backend: 'native';
  probe(): Promise<void>;
}

export interface CaveOfflineCacheKeyReference extends SecretStoreReference {
  readonly purpose: 'offline-cache';
}

export interface CaveNodeOfflineCacheOptions {
  readonly path: string;
  readonly keyStore: CaveNativeCacheKeyStore;
  readonly keyReference: CaveOfflineCacheKeyReference;
  readonly maxAgeMs?: number;
  readonly windowsPathTrust?: CaveWindowsCachePathTrustValidator;
}

export function createNodeCaveOfflineCache(
  options: CaveNodeOfflineCacheOptions,
): CaveOfflineCache;
```

`path` must be canonical and absolute. `keyReference` is a dedicated cache
key-record slot whose branded type cannot accept a Cave credential reference.
Add `createCaveOfflineCacheKeyReference(key)` for custom slots and
`createOpenCovenProfileCacheKeyReference(name)` to derive
`opencoven.profile.<name>.cache`, separate from the existing
`opencoven.profile.<name>.cave` credential reference.

### 6.2 `@opencoven/sdk-core`

Core continues to own operation controls, pagination, normalized errors,
profiles, and diagnostics. It gains only:

- cache diagnostic check/fact types and safe error codes;
- the diagnostic byte budget and per-field budgets;
- any reusable owner-private file identity types that are demonstrably generic.

Encryption and Cave resource semantics do not move into core merely to appear
generic.

### 6.3 Managed native hosts

`@opencoven/cave-client/managed` adds a narrow cache adapter beside the
existing credential/discovery bridge. The native host owns:

- OS keychain calls;
- key-record serialization;
- AES-256-GCM;
- cache path ownership, mode/ACL, reparse/symlink, lock, fsync, and rename;
- cleanup of validated abandoned temporary files;
- instance-bound archive inspection and reset.

The webview receives validated canonical read data and bounded status only.
It does not receive key IDs, keys, nonces, authentication tags, cache paths,
raw encrypted bytes, or keychain errors.

The managed boundary is operation-specific:

```ts
export interface CaveManagedOfflineCache {
  read(request: CaveOfflineCacheReadRequest): Promise<unknown>;
  replace(request: CaveOfflineCacheReplaceRequest): Promise<unknown>;
  inspect(): Promise<unknown>;
  reset(request: { readonly reason: 'explicit' | 'instance-replaced' }): Promise<unknown>;
}
```

The SDK snapshots and validates every request and result. `replace` accepts
only an already parsed allowed read projection; it is not a generic object,
file, SQL, route, or mutation bridge.

### 6.4 Private CLI

The CLI owns presentation and developer tooling:

- the sole grammar tree;
- argument parsing and help generated from that tree;
- static completion generation;
- one-page canonical read commands with explicit `--offline`;
- `cache status` and confirmed `cache reset`;
- fixed scaffold materialization;
- stable human/JSON rendering after model-level redaction.

No CLI module becomes a dependency of a public SDK package.

## 7. Public read repository

Existing methods such as `listProjects()` and `getConversation()` remain
live-only and keep their current return shapes.

An authority-bound client exposes:

```ts
export type CaveReadMode = 'live' | 'offline';

export type CaveCacheWriteDisposition =
  | { readonly status: 'stored' }
  | { readonly status: 'disabled' }
  | {
      readonly status: 'failed';
      readonly code: CaveOfflineCacheErrorCode;
    };

export type CaveReadProvenance =
  | {
      readonly source: 'cave';
      readonly stale: false;
      readonly observedAt: string;
      readonly instanceId: string;
      readonly revision: CaveReadRevision;
      readonly cacheWrite: CaveCacheWriteDisposition;
    }
  | {
      readonly source: 'cache';
      readonly stale: true;
      readonly cachedAt: string;
      readonly instanceId: string;
      readonly revision: CaveReadRevision;
    };

export interface CaveReadResult<T> {
  readonly value: T;
  readonly provenance: CaveReadProvenance;
}

export interface CaveReadRepository {
  readFamiliars(
    options: PageOptions & OperationOptions & { readonly mode: CaveReadMode },
  ): Promise<CaveReadResult<Page<CaveCanonicalFamiliar>>>;
  readProjects(
    options: PageOptions & OperationOptions & { readonly mode: CaveReadMode },
  ): Promise<CaveReadResult<Page<CaveProject>>>;
  readConversations(
    options: PageOptions & OperationOptions & { readonly mode: CaveReadMode },
  ): Promise<CaveReadResult<Page<CaveConversation>>>;
  readConversation(
    conversationId: string,
    options: OperationOptions & { readonly mode: CaveReadMode },
  ): Promise<CaveReadResult<CaveConversation>>;
  readTranscript(
    conversationId: string,
    options: PageOptions & OperationOptions & { readonly mode: CaveReadMode },
  ): Promise<CaveReadResult<Page<CaveConversationMessage>>>;
}
```

`mode` is required. There is no `auto`, `prefer-cache`, or `live-or-cache`
mode.

Authority-bound factories wire instance identity internally:

- discovered clients use the validated stored credential authority binding and
  the live health proof already required before authenticated reads;
- managed clients use native credential/authority state;
- a caller-supplied transport must provide a separately reviewed
  `CaveAuthorityIdentityProvider` or cannot create a persistent repository.

### 7.1 Live behavior

`mode: "live"`:

1. resolves the current trusted Cave instance;
2. performs the canonical read;
3. validates revision and response data;
4. rejects a response older than the repository's observed watermark;
5. attempts one serialized cache replacement;
6. returns canonical data with `source: "cave"` and `stale: false`.

A cache write failure does not relabel or discard a valid live response.
Instead, `cacheWrite.status` is `failed` with an allowlisted code. It also
updates bounded cache diagnostics. There is no fallback to older cache data.

### 7.2 Offline behavior

`mode: "offline"`:

- resolves expected instance identity only from native credential authority
  metadata already in custody;
- performs no discovery, fetch, socket, daemon, or compatibility request;
- looks up the exact normalized request;
- returns `cache_miss` if that exact page/record is absent or expired;
- returns `source: "cache"` and `stale: true` unconditionally on success.

If trusted instance identity is unavailable, offline reads fail with
`cache_identity_unavailable`. Forgetting the credential therefore disables
offline reads even if encrypted bytes remain.

List requests are exact. A cached `{ limit: 50, cursor: undefined }` entry does
not satisfy `{ limit: 25 }`, and the cache never slices, merges, sorts, or
re-pages producer output.

## 8. Cache archive format

### 8.1 Binary envelope

The committed cache is one binary file:

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0 | 8 | ASCII magic `OCVNCACH` |
| 8 | 1 | envelope version `1` |
| 9 | 1 | algorithm ID `1` for AES-256-GCM |
| 10 | 2 | flags, must be zero |
| 12 | 16 | UUID key ID as raw bytes |
| 28 | 12 | GCM nonce |
| 40 | 4 | big-endian ciphertext byte length |
| 44 | variable | ciphertext |
| end - 16 | 16 | GCM authentication tag |

The complete 44-byte header is authenticated additional data together with
the fixed context bytes `OpenCoven offline cache v1\0`. Unknown flags,
versions, algorithms, trailing bytes, lengths, or tag sizes fail closed before
plaintext allocation.

There is no compression. This avoids decompression bombs, format ambiguity,
and compression side channels.

### 8.2 Authenticated plaintext

The decrypted bytes are strict UTF-8 canonical JSON:

```ts
interface CaveOfflineArchiveV1 {
  readonly schema: 'opencoven.cave.offline-cache';
  readonly schemaVersion: 1;
  readonly instanceId: string;
  readonly committedAt: string;
  readonly entries: readonly CaveOfflineEntryV1[];
}

interface CaveOfflineEntryV1 {
  readonly resource: CaveRevisionResource;
  readonly request:
    | { readonly limit: number; readonly cursor: string | null }
    | { readonly detail: true };
  readonly revision: CaveReadRevision;
  readonly cachedAt: string;
  readonly payload: unknown;
}
```

The codec constructs fields in the order shown and emits no insignificant
whitespace. After decryption it parses, validates, reserializes, and requires
byte equality. Duplicate JSON keys, alternate number spelling, unknown fields,
decorated arrays, accessors, non-data properties, or non-canonical ordering
are rejected.

The schema, instance ID, resource keys, request keys, revisions, timestamps,
and payload are all GCM-authenticated. They remain inside ciphertext to avoid
leaking project, conversation, revision, or instance metadata through the
filesystem. The unauthenticated file contains no canonical DTO data.

### 8.3 Key record

One separate OS-keychain account is derived from the safe profile/cache slot.
Its value is:

```ts
interface CaveOfflineKeyRecordV1 {
  readonly version: 1;
  readonly active?: {
    readonly id: string;
    readonly key: string;
  };
  readonly staged?: {
    readonly id: string;
    readonly key: string;
  };
}
```

Each key is exactly 32 random bytes encoded as 43-character unpadded canonical
base64url. IDs are UUID v4. The key record contains no Cave instance ID,
resource ID, path, bearer, credential metadata, or revision.

Production creation requires an adapter explicitly identified as native secure
storage. A generic file store, environment variable, browser store, or memory
store is rejected outside test-only injection.

### 8.4 Fresh key and nonce per replacement

Every attempted archive replacement generates:

- a new 32-byte AES key;
- a new UUID key ID; and
- a new 12-byte CSPRNG nonce.

A key is used for at most one archive encryption attempt. Retrying after any
encryption or write failure generates another key and nonce. This removes
cross-write GCM nonce-reuse state and makes interruption recovery explicit.

## 9. Key/file replacement transaction

All steps run under one exclusive cache-slot lock:

1. Validate the parent, committed file if present, and key record.
2. Reconcile an interrupted dual-key state against the committed file header.
3. Generate a fresh staged key ID, key, and nonce.
4. Persist keychain record `{ active: old, staged: new }`.
5. Build and encrypt the full bounded archive in memory.
6. Create a same-directory random temporary file with exclusive creation and
   no-follow semantics.
7. Set owner-only permissions/ACL, write all bytes, sync the file, and
   revalidate its opened identity and size.
8. Atomically rename the temporary file over the committed path.
9. Sync the parent directory and revalidate the committed identity.
10. Persist keychain record `{ active: new }`.

The old key is retained until after rename and directory synchronization.
The new key is retained before any new encrypted bytes can become committed.

### 9.1 Interruption outcomes

| Interruption point | Required next-open behavior |
| --- | --- |
| before staged key record | old archive/key remain authoritative |
| after staged key, before rename | old header selects `active`; discard `staged` and validated temp |
| after rename, before key finalization | new header selects `staged`; promote it to `active` |
| after key finalization | new archive/key are authoritative |
| file or directory sync reports failure | report not durable; next open reconciles the header against both retained keys |

Temporary files never become read candidates. Cleanup removes only a regular,
owner-private, same-directory file whose name and recorded transaction ID match
the current cache slot. Unknown files are untouched.

### 9.2 Reset

Explicit reset:

1. takes the lock;
2. validates and unlinks the committed archive;
3. syncs the parent directory;
4. removes validated abandoned temporary files for the slot;
5. deletes the keychain record.

File removal happens before key deletion. If key deletion fails, reset reports
`cache_key_delete_failed`, but cached plaintext is no longer recoverable from
the filesystem. The CLI never reports successful reset until directory sync
and key deletion both succeed.

### 9.3 Instance replacement

When a live authority proves a different instance ID, the repository must not
read or merge the previous instance's entries. It replaces the archive with an
empty archive bound to the new instance before attempting to cache the new
response. If this purge fails, the live response may still return with a failed
cache disposition, but subsequent offline reads compare expected instance ID
and refuse the old archive.

## 10. Resource and retention budgets

The first implementation uses fixed hard ceilings. Callers may configure lower
values, never higher ones.

| Budget | Default/hard maximum |
| --- | ---: |
| committed file, including header/tag | 8 MiB |
| decrypted canonical JSON | 8 MiB minus envelope overhead |
| one validated live response payload | 64 KiB UTF-8 |
| archive entries | 128 |
| pages per resource key | 8 |
| distinct conversation IDs across detail/transcript entries | 32 |
| nodes per entry before serialization | 4,096 |
| total decoded nodes | 131,072 |
| nesting depth | 64 |
| one resource ID | 1,024 UTF-8 bytes |
| one revision token | 128 characters |
| default retention | 7 days |
| configurable retention maximum | 30 days |

Retention is evaluated from `cachedAt` using an injected/testable wall clock.
Entries more than five minutes in the future are malformed. A backward system
clock can delay age eviction, but cannot bypass byte, entry, node, or resource
caps.

Before a replacement, the cache:

1. removes expired entries;
2. removes every older revision for the incoming resource;
3. inserts or replaces the exact request entry;
4. evicts the oldest conversation-bound groups until the 32-ID cap holds;
5. evicts oldest remaining entries by `(cachedAt, canonicalRequestKey)` until
   every byte/count budget holds.

Payloads are never truncated. If the incoming entry cannot fit by itself, the
write fails with `cache_limit` and the previous archive remains committed.

## 11. Failure and recovery semantics

### 11.1 Tamper and wrong key

Header tamper, ciphertext tamper, tag tamper, and a wrong key all surface the
same public `cache_undecryptable` result with `resetRequired: true`. The cache
does not reveal which GCM check failed and does not automatically delete the
file. This avoids a diagnostic oracle and preserves explicit operator control.

### 11.2 Schema mismatch and corruption

- unsupported binary envelope: `cache_schema_mismatch`;
- successful decrypt but unsupported logical schema: `cache_schema_mismatch`;
- invalid canonical JSON or invalid allowed payload: `cache_corrupt`;
- oversize before allocation/read: `cache_limit`;
- missing file and missing key record: clean empty cache;
- missing file with key record: remove the orphan key record, then report empty;
- present file with missing key record: `cache_undecryptable`, explicit reset;
- header key ID matching neither active nor staged: `cache_undecryptable`.

Unreadable, corrupt, or unsupported archives never fall back to partially
decoded entries.

### 11.3 Locks and filesystem trust

- Lock acquisition has one five-second budget and a 25 ms retry interval.
- A matching live process token is never displaced based only on age.
- Dead owners and verified PID reuse may be recovered.
- Malformed owner records are recoverable only after 30 seconds.
- Unix parents must be canonical, non-symlink directories owned by the
  effective user with no group/other permissions.
- Unix files must be regular, non-symlink, single-link files owned by that user
  with mode `0600`.
- Windows requires a reviewed native ownership/ACL/reparse validator and
  process-wide named mutex. Metadata-only trust and shell commands are
  forbidden.
- Any path/identity change between validation, open, sync, rename, and
  revalidation fails closed.

## 12. Canonical authority and mutation prohibition

The cache is not consulted for:

- authorization or capability checks;
- credential validity, revocation, or scope;
- mutation preconditions;
- idempotency or replay;
- conflict resolution;
- authority discovery or endpoint selection.

Future mutation APIs from SDK #42 or #43 must require:

1. a live authority proof for the current instance;
2. a fresh canonical read where the mutation protocol requires state; and
3. producer-owned idempotency/revision semantics.

`CaveReadResult` with `source: "cache"` is never accepted as a mutation
precondition. Reconnect does not upgrade cached data to fresh. The consumer
must perform a new `mode: "live"` read.

## 13. Diagnostics and redaction

### 13.1 Diagnostic model

The existing report stays allowlist-first. Add at most two checks:

- `cache.key-custody`;
- `cache.storage`.

Approved cache facts are:

```ts
interface OpenCovenDiagnosticCacheFacts {
  readonly backend?: 'native';
  readonly state?:
    | 'empty'
    | 'ready'
    | 'expired'
    | 'reset-required'
    | 'update-in-progress';
  readonly schemaVersion?: 1;
  readonly entryCount?: number;
  readonly encryptedBytes?: number;
  readonly staleOnly?: true;
  readonly lastCommittedAt?: string;
}
```

Diagnostics never include:

- cache path or parent path;
- keychain service/account, key ID, key, staged/active state;
- nonce, tag, ciphertext, file identity, lock owner, process token, or raw
  native error;
- full Cave instance ID;
- resource IDs, conversation IDs, request cursors, revision tokens, project
  roots, repo URLs, message text, titles, or timestamps from content;
- raw archive bytes or a diagnostic archive.

Tamper and wrong-key diagnostics both use `cache_undecryptable`.

### 13.2 Budgets

- 16 unique checks remain the hard report limit.
- The final canonical JSON report is at most 16 KiB UTF-8.
- A check has at most 12 fact fields.
- Diagnostic string facts are at most 64 characters unless an existing
  stricter pattern applies.
- Error details are selected by an error-code-specific allowlist, at most eight
  scalar fields, with keys at most 32 characters and strings at most 128
  characters.
- Human rendering is derived from the already-budgeted report and emits at
  most two lines per check plus one summary line.

`packages/cli/src/output.ts` must stop merging arbitrary scalar `details` or
`diagnostics`. Recursive sensitive-key replacement remains defense in depth,
not the primary redaction boundary.

## 14. CLI grammar and completion contract

### 14.1 One source of command truth

Create `packages/cli/src/grammar.ts`:

```ts
export const CLI_GRAMMAR_VERSION = 1;

export const CLI_GRAMMAR = {
  name: 'opencoven',
  commands: [
    // fixed reviewed tree
  ],
} as const;
```

Each node declares:

- fixed command token and description;
- positional arguments with fixed arity and optional enum values;
- valid flags, value kinds, and whether a flag is repeatable;
- whether human, JSON, or raw-script output is supported;
- child commands.

The parser, help/usage renderer, `CLI_USAGE`, completion generators, and grammar
goldens consume this tree. No second command inventory is maintained in tests
or documentation. A repository test fails if CLI command/flag literals are
introduced outside the grammar allowlist and command implementation dispatch.

### 14.2 Frozen private grammar

The #44 private workspace grammar is:

```text
opencoven --help
opencoven --version
opencoven doctor [--json]
opencoven discover [--json]
opencoven cave pair [--json]
opencoven cave status [--json]
opencoven cave forget [--json]
opencoven cave familiars [--limit <1..100>] [--cursor <token>] [--offline] [--json]
opencoven cave projects [--limit <1..100>] [--cursor <token>] [--offline] [--json]
opencoven cave conversations [--limit <1..100>] [--cursor <token>] [--offline] [--json]
opencoven cave conversation <id> [--offline] [--json]
opencoven cave transcript <id> [--limit <1..100>] [--cursor <token>] [--offline] [--json]
opencoven cache status [--json]
opencoven cache reset --confirm-reset [--json]
opencoven completion <bash|zsh|fish|powershell>
opencoven scaffold <cave-read|coven-observer|unified-status> <destination>
  [--allow-empty-directory] [--json]
```

Read commands return one page only. There is no `--all`. `--offline` is valid
only on the five read commands. Human offline output begins with
`STALE CACHE`; JSON output contains the same sourced provenance model as the
SDK.

`completion` emits a script to stdout, rejects `--json`, and performs no
discovery, keychain, cache, filesystem, or network I/O. Scripts contain only
the fixed grammar; they never execute `opencoven` dynamically during tab
completion and never complete resource IDs, paths, profiles, or remote data.

### 14.3 Completion stability

- Bash, Zsh, Fish, and PowerShell output each have byte-for-byte goldens.
- Command ordering is grammar order; option ordering is lexical within a node.
- Descriptions are fixed, single-line, and shell-escaped by dedicated
  generators.
- Grammar version changes require intentional golden updates and a CLI
  changelog entry.
- Completions are emitted, not installed. The CLI never edits shell startup
  files.

## 15. Fixed safe scaffolds

### 15.1 Catalog

The only template IDs are:

1. `cave-read` — one bounded canonical Cave read using a deterministic
   caller-owned transport;
2. `coven-observer` — Coven health with operation observer events;
3. `unified-status` — separate Cave/Coven clients composed through
   `@opencoven/sdk`.

Each scaffold contains exactly:

```text
.gitignore
README.md
package.json
tsconfig.json
src/index.ts
```

The examples perform no external network access and run deterministically.
Their manifests use exact aligned SDK versions, contain no install lifecycle
scripts, and have only `build`, `typecheck`, and `start` scripts. There are no
template expressions, hooks, arbitrary package names, remote downloads, or
post-generation commands.

The reviewed files live under `packages/cli/scaffolds/<id>/` with a catalog
containing SHA-256 and byte size for every file. Materialization verifies the
bundled catalog before writing.

### 15.2 Destination policy

Default policy accepts only a nonexistent destination whose existing parent:

- resolves canonically;
- is a real directory, not a symlink/reparse point;
- passes platform ownership and permission checks.

`--allow-empty-directory` additionally permits an existing, canonical,
non-symlink directory that is empty at both validation and first write.

There is no `--force`. Non-empty destinations, symlinked destinations, unsafe
parents, special files, mount/reparse changes, and races fail closed.

For a nonexistent destination, generation writes a same-parent staging
directory and atomically renames it into place. For an approved existing empty
directory, every file is created with exclusive creation; interruption cleanup
removes only files whose identities were created by that invocation. The CLI
never deletes pre-existing entries.

User input selects only a fixed template and destination. It is not
interpolated into source, JSON, package names, commands, or README content.

## 16. Browser and native limits

### 16.1 Browser/webview

- `@opencoven/cave-client/node-cache` is absent from browser export maps and
  browser bundles.
- Browser-safe bundles contain no `node:*`, `Buffer`, keyring, filesystem,
  process-spawn, or crypto-file adapter.
- A plain browser without a reviewed native host can use live caller-supplied
  transports but cannot enable persistent offline cache.
- Webview managed results are bounded by the existing managed snapshot rules
  and the stricter cache-entry/archive budgets.
- Cached message text may enter JavaScript only as the canonical data requested
  for display. Cryptographic material and raw storage never do.

### 16.2 Native

- The initial conformance targets remain `darwin-arm64`, `linux-x64`, and
  `win32-x64`; #44 does not widen them.
- macOS uses Keychain, Linux uses the approved keyring backend, and Windows
  uses Credential Manager or the already-approved equivalent native custody.
- Missing, locked, unavailable, or unsupported secure storage fails
  `cache_key_unavailable`; there is no plaintext fallback.
- Windows file trust requires SID/ACL/reparse validation and a named mutex.
- Unix requires effective-user ownership, owner-private directories, `0600`
  files, no symlink traversal, and single-link committed files.
- Cross-platform implementations consume shared deterministic format vectors.

## 17. Error contract

```ts
export type CaveOfflineCacheErrorCode =
  | 'cache_corrupt'
  | 'cache_identity_unavailable'
  | 'cache_instance_mismatch'
  | 'cache_key_delete_failed'
  | 'cache_key_unavailable'
  | 'cache_limit'
  | 'cache_miss'
  | 'cache_not_supported'
  | 'cache_revision_conflict'
  | 'cache_schema_mismatch'
  | 'cache_stale_response'
  | 'cache_undecryptable'
  | 'cache_update_in_progress'
  | 'cache_write_failed'
  | 'unsafe_cache_path';
```

| Code | Retryable | Reset required | Meaning |
| --- | --- | --- | --- |
| `cache_miss` | no | no | exact entry absent or expired |
| `cache_not_supported` | no | no | authority lacks real revision support |
| `cache_identity_unavailable` | no | no | trusted expected instance unavailable |
| `cache_stale_response` | yes | no | late live result older than observed watermark |
| `cache_revision_conflict` | no | no | tokens conflict at one producer timestamp |
| `cache_instance_mismatch` | no | automatic purge | archive belongs to another known instance |
| `cache_update_in_progress` | yes | no | lock/transaction is currently owned |
| `cache_limit` | no | only if stored file oversize | a hard resource budget was exceeded |
| `cache_key_unavailable` | no | no | native key custody unavailable |
| `cache_undecryptable` | no | yes | wrong key, tamper, missing key, or authentication failure |
| `cache_schema_mismatch` | no | yes | unsupported binary/logical schema |
| `cache_corrupt` | no | yes | decrypted canonical data invalid |
| `unsafe_cache_path` | no | no | ownership, ACL, link, type, or identity failure |
| `cache_write_failed` | conditional | no | bounded native write/sync/rename failure |
| `cache_key_delete_failed` | no | retry reset | file removed but orphan key record remains |

Public messages are fixed. Native causes remain local and must not enter
observers, diagnostics, CLI details, or retained evidence.

## 18. Implementation file map

### Create

- `packages/cave/src/revisions.ts` — revision types, parsing, comparison, and
  resource keys.
- `packages/cave/src/offline-reads.ts` — sourced repository and cache
  orchestration.
- `packages/cave/src/node-cache.ts` — Node-only AES/file/key-record adapter.
- `packages/cave/src/node-cache-format.ts` — binary/canonical JSON codec and
  vectors.
- `packages/cli/src/grammar.ts` — sole command grammar.
- `packages/cli/src/completions.ts` — four static generators.
- `packages/cli/src/cache.ts` — private cache status/reset command handlers.
- `packages/cli/src/scaffold.ts` — fixed catalog and safe materialization.
- `packages/cli/scaffolds/{cave-read,coven-observer,unified-status}/...` —
  reviewed deterministic projects.
- `tests/cave-revisions.spec.ts`
- `tests/cave-offline-reads.spec.ts`
- `tests/cave-node-cache.spec.ts`
- `tests/cave-node-cache-faults.spec.ts`
- `tests/cave-managed-cache.spec.ts`
- `tests/cli-grammar.spec.ts`
- `tests/cli-completions.spec.ts`
- `tests/cli-scaffold.spec.ts`
- `tests/fixtures/offline-cache-v1/*` — deterministic Node/Rust vectors.

### Modify

- producer Cave contract, docs, operations/capabilities, read routes, fixture,
  and conformance scripts;
- `packages/cave/src/canonical-reads.ts`, `client.ts`, `schemas.ts`,
  `transport.ts`, `managed.ts`, `index.ts`, package exports/tsup config,
  README, changelog, and API baseline;
- `packages/core/src/diagnostics.ts`, exports, README, changelog, and baseline;
- `packages/cli/src/main.ts`, `doctor.ts`, `output.ts`, `index.ts`, README,
  changelog, and package files;
- `scripts/verify-package.mjs` and packed-package tests;
- `examples/README.md`, root README, `SUPPORT.md`, and browser/native guidance;
- Chat's Tauri native cache implementation and exact packed canary.

## 19. Pull-request order

No PR should combine producer contract authorization, native cryptography,
CLI distribution, and scaffold UX into one review.

1. **Cave producer revision PR**
   - emit revisions on all five reads;
   - add truthful `revisions` capability;
   - update fixture/docs and real-socket revision tests.
2. **SDK revision contract PR**
   - import exact producer fixture;
   - add revision parsing/comparison and versioned internal read results;
   - retain current live-only public methods.
3. **SDK Node encrypted-cache PR**
   - add format codec/vectors, native key-store contract, file transaction,
     budgets, reset, diagnostics hooks, and negative tests.
4. **SDK sourced-read/managed-boundary PR**
   - add `CaveReadRepository`;
   - add managed cache calls and browser bundle limits;
   - add supersession, instance purge, offline semantics, and packed API
     baselines.
5. **SDK diagnostics PR**
   - add cache checks/facts and 16 KiB budget;
   - replace arbitrary CLI scalar-detail merging with code-specific allowlists.
6. **Private CLI grammar/completion/read PR**
   - freeze the grammar;
   - generate parser/help/completions;
   - add bounded live/offline read and cache status/reset commands;
   - keep CLI private and outside public artifacts.
7. **Private CLI scaffolds/packed-examples PR**
   - add fixed catalog and safe destination transaction;
   - compile/run all three projects from exact public tarballs.
8. **Chat native cache/conformance PR**
   - implement Rust keychain/AES/filesystem boundary;
   - consume exact SDK tarballs;
   - pass the three-target interruption/tamper matrix.
9. **Security disposition PR/evidence**
   - review exact Node and Chat implementations;
   - close findings before #44 completion.
10. **Separate CLI public/defer decision**
    - either retain private status, or explicitly approve package inventory,
      native adapters, signing, updates, supported targets, packed binary, and
      completion/scaffold distribution.

PR 10 is not implied by PRs 6 or 7.

## 20. Full validation matrix

### 20.1 Revision and sourced-read tests

| Case | Expected result |
| --- | --- |
| all five envelopes contain valid revision | parsed and exposed |
| missing revision or `revisions` capability | live method works; cache disposition `cache_not_supported` |
| token empty/over 128/non-data accessor | `invalid_response` |
| non-canonical or invalid timestamp | `invalid_response` |
| same token/same timestamp | exact page merge |
| same token/different timestamp | `invalid_response` |
| newer timestamp/new token | all old resource pages removed |
| older timestamp/new token arriving late | `cache_stale_response`; newer cache retained |
| equal timestamp/different token | `cache_revision_conflict` |
| page two has another revision | old resource pages removed; no mixed snapshot |
| exact cached request | stale cache result |
| different limit/cursor | `cache_miss` |
| expected instance unavailable | `cache_identity_unavailable` |
| expected instance differs | purge/refusal; no old plaintext |
| live authority failure | rejection; no implicit cache fallback |
| offline mode | zero discovery/network/native-authority calls |
| cached result inspected | always `source: cache`, `stale: true` |
| live result inspected | always `source: cave`, `stale: false` |
| mutation API given cached result | compile-time absence plus runtime refusal where applicable |

### 20.2 Cryptographic and format tests

| Case | Expected result |
| --- | --- |
| AES key length not 32 | reject |
| nonce length not 12 | reject |
| tag length not 16 | reject |
| two successful replacements | distinct key IDs, keys, and nonces |
| retry after failed encryption/write | another new key and nonce |
| magic/version/algorithm/flags tamper | schema/undecryptable failure |
| key ID, nonce, or ciphertext length tamper | authentication/format failure |
| ciphertext bit flip | `cache_undecryptable` |
| tag bit flip | `cache_undecryptable` |
| wrong matching key bytes | `cache_undecryptable` |
| header key ID matches neither key | `cache_undecryptable` |
| truncate at every byte boundary near header/tag | safe failure, no overread |
| declared length overflow/trailing bytes | safe failure before allocation |
| invalid UTF-8 after authenticated decrypt vector | `cache_corrupt` |
| duplicate JSON keys/non-canonical order/number | `cache_corrupt` |
| unknown schema field/version | `cache_schema_mismatch` |
| plaintext sentinel scan of file/temp/lock/key metadata | no DTO or secret sentinel in filesystem bytes |
| deterministic Node/Rust vectors | identical AAD, plaintext, ciphertext, and tag |

Randomness is injectable only in tests. Production has no deterministic or
caller-supplied nonce/key option.

### 20.3 Key transaction and interruption tests

Inject a fault after every numbered transaction step in section 9.

| Committed header versus key record | Recovery |
| --- | --- |
| no file/no key | empty |
| no file/active key | delete orphan, empty |
| no file/staged key | delete orphan, empty |
| old file/active old + staged new | discard staged |
| new file/active old + staged new | promote staged |
| file/key ID absent from record | reset-required |
| file removed/key delete fails | no data; `cache_key_delete_failed` |
| keychain unavailable before write | previous archive unchanged |
| keychain unavailable after rename | dual key record keeps new file readable |
| repeated recovery | idempotent |

Tests also cover two process contenders, lock timeout, dead owner, live owner,
PID reuse with different process token, malformed young/old owner, release
failure, and no deletion of a newer owner's lock.

### 20.4 Filesystem/ACL and atomicity tests

- missing parent, relative path, non-canonical path;
- symlink/reparse parent or committed file;
- directory where file expected, FIFO/device/socket, hard link count above one;
- wrong Unix owner/mode, group/other writable parent;
- Windows wrong SID, inherited broad ACL, reparse change, validator absent;
- file identity swap before/after open, write, sync, rename, and final stat;
- oversize file rejected before full allocation;
- pre-existing temporary name and hostile temporary symlink;
- partial write, zero-byte write, short write loop, file sync failure,
  rename failure, directory sync failure, final identity mismatch;
- abandoned validated temp cleanup and unknown-file preservation;
- old committed archive remains byte-identical on every pre-rename failure;
- post-rename recovery yields the complete new archive, never a partial mix.

### 20.5 Resource-budget and exclusion tests

- 0, 1, 128, and 129 entries;
- 8 pages and a ninth page for one resource;
- 32 and 33 conversation IDs;
- 4,096 and 4,097 nodes per entry;
- depth 64 and 65;
- exact 64 KiB and one byte over per payload;
- exact 8 MiB and one byte over archive;
- seven-day expiry, configurable shorter expiry, rejection above 30 days;
- timestamp more than five minutes in the future;
- deterministic oldest-entry and conversation-group eviction;
- single incoming entry too large leaves old archive unchanged;
- bearer, pairing secret, credential record, authority binding, keychain
  account, idempotency key, draft, pending mutation, attachment bytes, event
  stream, action payload, and diagnostic archive canaries never serialize;
- message attachment/tool counts are allowed, attachment bytes are not;
- unknown producer fields containing secret canaries are dropped before cache.

### 20.6 Diagnostics tests

- ready, empty, expired, update-in-progress, and reset-required cache states;
- tamper and wrong key produce the same public code/message;
- no path, key ID, nonce, tag, cursor, revision, resource ID, project root,
  repo URL, title, or message text in report/human/JSON;
- hostile getters, proxies, symbols, cycles, sparse/decorated arrays, and
  revoked proxies invoke no attacker code;
- duplicate/unknown check IDs rejected;
- 16 checks accepted, 17 rejected;
- 16 KiB exact boundary and one byte over;
- arbitrary scalar error detail keys are discarded;
- every output-format secret-canary scan passes;
- raw causes remain local and are absent from observers and retained evidence.

### 20.7 Grammar, completion, and scaffold tests

- parser, help, usage, and all completion generators enumerate exactly the
  grammar;
- every command accepts only its declared options and arity;
- `--offline` rejected outside read commands;
- `--all`, unknown shell/template, repeated non-repeatable options, option
  smuggling, `--` ambiguity, control characters, and overlong values rejected;
- completion generation performs zero I/O and emits byte-exact Bash/Zsh/Fish/
  PowerShell goldens;
- completion scripts contain no command substitution, eval, dynamic
  `opencoven` call, filesystem scan, or network lookup;
- nonexistent safe scaffold destination succeeds atomically;
- existing directory rejected by default;
- existing verified empty directory accepted only with
  `--allow-empty-directory`;
- non-empty, symlink/reparse, special-file, unsafe-parent, race-replaced, and
  hostile Unicode/control-character destinations fail closed;
- interruption at each scaffold write rolls back only invocation-owned files;
- unknown template, manifest hash mismatch, duplicate path, absolute path,
  `..`, separator injection, symlink entry, and oversized template fail;
- generated projects contain no lifecycle hooks, remote template references,
  workspace/file dependencies, shell commands, or user interpolation.

### 20.8 Packed and browser tests

While the CLI remains private:

1. Pack the four public packages in canonical order.
2. Install each scaffold into a clean isolated consumer after warming, remove
   warm module trees, then install with `--offline`.
3. Rewrite only the test copy's exact SDK dependency values to the produced
   tarball specifiers.
4. Typecheck, build, and run all three scaffolds.
5. Install a blank Node consumer for
   `@opencoven/cave-client/node-cache`; verify exports/types/import purity and
   run encrypted-cache vectors with a fake native key store.
6. Bundle a managed browser consumer and fail if it contains Node built-ins,
   `Buffer`, keyring names, cache path strings, or Node cache exports.
7. Run managed cache success, oversize, secret-field, tamper-status, and native
   rejection canaries from exact tarballs.
8. Assert public tarballs contain no CLI or scaffold files.

If a later PR authorizes public CLI distribution, add before publication:

- packed CLI tarball and global binary installation in a blank project;
- `opencoven --help`, all four completion goldens, one live deterministic read,
  one offline read, cache status/reset, and all three scaffold commands from
  the packed binary;
- package signing/update/native dependency review on every supported target;
- exact release inventory, Changesets, manifest, provenance, and trusted
  publisher updates.

### 20.9 Canonical verification

Each SDK PR runs the smallest focused tests above, then:

```bash
corepack pnpm@10.34.0 typecheck
corepack pnpm@10.34.0 test
corepack pnpm@10.34.0 verify:package
corepack pnpm@10.34.0 verify:release
corepack pnpm@10.34.0 lint
```

The final exact candidate runs `corepack pnpm@10.34.0 verify`, dedicated native
tests on all three targets, real Cave revision/cache journeys, the packed Chat
canary, secret scans, and the dedicated security review.

## 21. Completion criteria

SDK #44 is complete only when:

- Cave revisions are live, truthful, source-locked, and consumed by the SDK;
- every cached byte belongs to an allowed canonical read projection;
- archive, key, nonce, AAD, atomic replacement, recovery, and reset contracts
  pass the complete negative matrix;
- stale and live provenance cannot be confused in SDK, CLI, or diagnostics;
- an older response cannot overwrite or be returned after a newer observed
  revision;
- a known instance replacement prevents old-instance offline reads;
- offline mode performs no write or authority I/O and cannot authorize a
  mutation;
- diagnostics meet byte/count budgets and expose no disallowed data;
- completions derive exactly from one frozen grammar;
- scaffolds are fixed, destination-safe, and compile/run from exact public
  tarballs;
- browser bundles contain no native cache implementation or cryptographic
  custody material;
- native conformance passes on `darwin-arm64`, `linux-x64`, and `win32-x64`;
- the CLI remains private unless the separate public distribution gate passes;
- exact-candidate security review reports no unresolved blocking finding.
