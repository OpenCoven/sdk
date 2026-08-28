# OpenCoven SDK Conversational Control Design

**Status:** Implementation-ready plan of record for SDK #42; implementation
remains blocked by SDK #41 and new Cave Client v1 producer work

**Date:** 2026-08-28

**Issue:** [OpenCoven/sdk#42](https://github.com/OpenCoven/sdk/issues/42)

**Decision owner:** OpenCoven maintainers

## 1. Executive decision

The first post-read-only authority tier adds a narrow, canonical conversation
control path:

1. create an empty conversation for one familiar;
2. send one text message to an existing conversation;
3. observe that send through a typed, resumable event stream;
4. stop the send explicitly;
5. retry an explicitly failed or cancelled assistant turn with a fresh
   operation UUID and `retryOfTurnId`;
6. reload canonical conversation history when event continuity cannot be
   proved.

Cave remains the sole mutation executor, idempotency authority, operation
journal, replay authority, stop authority, audit producer, and canonical
conversation owner. The SDK validates and translates a fixed Client v1
contract. Chat supplies the native credential boundary and product state. The
private CLI is an SDK consumer, not a second protocol implementation.

This design does **not** expose Cave's private `/api/chat/*` routes. It also
does not make transport abort equivalent to Stop, does not automatically retry
an ambiguous mutation, and does not introduce an offline mutation queue.

## 2. Exact state used for this design

The following state was verified on 2026-08-28:

| Repository or issue | Exact state | Consequence for #42 |
| --- | --- | --- |
| `OpenCoven/sdk` | `origin/main` at `acc38488f00860d246c3c553375634d64806eabb` | `@opencoven/cave-client` exposes health, pairing, credential custody, five canonical reads, and four bounded iterators. `CaveTransport` has no mutation or event methods. |
| SDK #42 | Open, blocked by #41 | This spec may land, but implementation and release must not bypass the read-only release gate. |
| SDK #41 | Open | Publication remains locked. |
| SDK #40 | Open with **BLOCK** disposition | Exact-candidate review still waits on #38 evidence. |
| SDK #38 | Open | Real-authority evidence remains required on `darwin-arm64`, `linux-x64`, and `win32-x64`. |
| `OpenCoven/coven-cave` | `main` at `74fc4e010cc79287415a10821882baf64e6f08f9` | Client v1 has fourteen reviewed operations: bootstrap, admin, and five reads. It has no Client v1 write or event route. The latest private-chat change reinforces server-owned conversation origin rather than adding a public mutation contract. |
| Cave Client v1 contract | `apiVersion: "1.0"`; write scopes and a 36-character idempotency-key limit are reserved but unused | #42 is additive within Client v1, but Cave must author and export the mutation contract before the SDK implements it. |
| Cave private chat | `/api/chat/send`, `/api/chat/stream`, and `/api/chat/stop` exist | They are implementation evidence only. Their optional `runId`, process-local stop registry, 512 KiB process-local event ring, two-minute finished retention, SSE shapes, and benign resume-gap progress row are not public Client v1 contracts. |
| Cave open PR #5163 | iOS application retry work | It is not Client v1 idempotency or mutation authority and is not a #42 dependency. |
| `OpenCoven/chat` | `main` at `0021d30d0cddc5d3f00a41c55d025cf3ce4611c5` | The Tauri boundary exposes health, pairing, credential status, and the five reads only. |
| Chat #27 / PRs #30 and #34 | #27 remains open; #30 and #34 are open | Read-only native conformance and canonical artifact consolidation must finish before Chat adds write authority. |

The current Cave contract code is authoritative when its prose is stale. In
particular, current `contract.ts` and `operations.ts` contain fourteen
operations even though the opening paragraph of `docs/api/client-v1.md` still
says thirteen.

The SDK's currently vendored base fixture is pinned to Cave
`4adc97b1bdafd1012ce4c66de598e82f49329f79`; later HPKE authority material is
verified separately. #42 must import one exact producer commit that contains
the completed mutation contract. It must not infer new routes from moving Cave
`main`.

No open Cave issue or PR currently defines the Client v1 create/send/event/stop
contract. The first implementation action therefore belongs upstream in Cave.

## 3. Scope resolution

### 3.1 Included

- canonical conversation creation;
- text-only send to an existing canonical conversation;
- caller-supplied, caller-visible operation UUIDs;
- persistent idempotency and canonical request hashes;
- persistent operation status and typed event replay;
- explicit Stop;
- explicit retry of a failed or cancelled assistant turn;
- canonical reconciliation after replay gaps, operation expiry, or branch
  movement;
- direct and managed-native SDK transports;
- private CLI consumption and deterministic human/JSON/NDJSON ordering;
- packed consumer and real-authority conformance.

### 3.2 Deferred from #42

The phrase "create/update/delete where approved" in the issue does not itself
approve update or delete. Client v1 currently emits and consumes no revision
token, and a revisionless update/delete would weaken the canonical read model.
Therefore #42 ships **create only** for conversation records.

Conversation title/model/runtime updates, branch selection, and deletion need a
separate revisioned mutation design.

## 4. Producer contract Cave must freeze first

The names below are the proposed Client v1 additions. They are not present in
the current producer. Cave must review them in `contract.ts`,
`operations.ts`, route ownership tests, generated fixture, and Client v1 docs
before the SDK treats them as real.

| Operation ID | Method and path | Scope | Purpose |
| --- | --- | --- | --- |
| `conversations.create` | `POST /api/client/v1/conversations` | `conversations:write` | Create one empty canonical conversation. |
| `messages.send` | `POST /api/client/v1/conversations/:id/messages` | `chat:write` | Accept one text send or one explicit retry. |
| `operations.read` | `GET /api/client/v1/operations/:id` | `chat:write` | Read non-content operation state and replay bounds. |
| `operations.events` | `GET /api/client/v1/operations/:id/events` | `chat:write` | Read a bounded event page, optionally waiting for new events. |
| `operations.stop` | `POST /api/client/v1/operations/:id/stop` | `chat:write` | Persist Stop intent and signal the canonical executor. |

Capability membership is additive:

- `conversations.create` joins `conversations`;
- `messages.send` joins `conversation-messages`;
- the three operation routes introduce `conversation-operations`;
- `operations.events` also joins `cursors`.

All five routes are paired-bearer operations and must be protected by the
active Client v1 authority mechanism. They must not be added to
`CLIENT_V1_PUBLIC_ROUTES`.

The producer must also add exact generated-fixture limits:

```ts
{
  conversationMessageTextBytes: 32_768,
  conversationEventPageSize: 100,
  conversationEventPageBytes: 262_144,
  conversationEventWaitMs: 25_000,
  conversationEventRetentionBytes: 1_048_576,
  conversationEventRetentionCount: 10_000,
  conversationEventRetentionMs: 86_400_000,
  conversationIdempotencyResultRetentionMs: 604_800_000
}
```

These bounds fit inside the current HPKE request-body and response-plaintext
ceilings. A producer implementation that needs different values must amend this
spec and its conformance expectations rather than silently changing them.

### 4.1 Why the event route is bounded long polling

Current `hpke-bound-v1` authenticates and seals a complete response body. It
does not define independently authenticated streaming frames. Exposing an SSE
response through that wrapper would require a new cryptographic stream
contract, while exposing plaintext SSE would discard the authority binding
that unblocked the read-only release.

Therefore `operations.events` returns a bounded JSON event page. It may wait up
to 25 seconds when no event is available. The SDK repeatedly invokes that same
route and exposes an `AsyncGenerator`, giving consumers a typed stream without
inventing `hpke-stream-v1`.

Native SSE, WebSocket transport, and a new chunk-authentication mechanism are
future optimizations. They may replace the transport only if they preserve the
same operation, event, cursor, replay-gap, and translator semantics.

## 5. Public SDK surface

The SDK adds constrained types and methods to `@opencoven/cave-client`.
Names are specific to conversations so they do not collide with core
`OperationOptions` or imply a generic mutation escape hatch.

```ts
export type CaveConversationOperationId = string;
export type CaveConversationEventCursor = string;

export interface CaveCreateConversationRequest {
  operationId: CaveConversationOperationId;
  familiarId: string;
  projectId?: string;
}

export type CaveSendConversationMessageRequest =
  | {
      operationId: CaveConversationOperationId;
      text: string;
      retryOfTurnId?: never;
    }
  | {
      operationId: CaveConversationOperationId;
      retryOfTurnId: string;
      text?: never;
    };

export type CaveConversationOperationState =
  | "accepted"
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "cancelled";

export interface CaveConversationOperation {
  id: CaveConversationOperationId;
  kind: "conversation.create" | "message.send" | "message.retry";
  state: CaveConversationOperationState;
  conversationId: string;
  inputTurnId?: string;
  outputTurnId?: string;
  retryOfTurnId?: string;
  failureCode?: string;
  latestEventId: number;
  replayFloorEventId: number;
  createdAt: string;
  updatedAt: string;
  idempotencyResultExpiresAt?: string;
}

export interface CaveCreateConversationResult {
  operationId: CaveConversationOperationId;
  replayed: boolean;
  conversation: CaveConversation;
}

export interface CaveSendConversationMessageResult {
  operation: CaveConversationOperation;
  replayed: boolean;
}

export interface CaveConversationEventBase {
  operationId: CaveConversationOperationId;
  eventId: number;
  cursor: CaveConversationEventCursor;
  occurredAt: string;
}

export type CaveConversationEvent =
  | (CaveConversationEventBase & {
      type: "operation.accepted";
      conversationId: string;
      inputTurnId: string;
      retryOfTurnId?: string;
    })
  | (CaveConversationEventBase & {
      type: "assistant.delta";
      text: string;
    })
  | (CaveConversationEventBase & {
      type: "operation.stopping";
    })
  | (CaveConversationEventBase & {
      type: "operation.completed";
      outputTurnId: string;
    })
  | (CaveConversationEventBase & {
      type: "operation.failed";
      outputTurnId: string;
      code: string;
    })
  | (CaveConversationEventBase & {
      type: "operation.cancelled";
      outputTurnId: string;
    });

export interface CaveConversationStreamOptions extends OperationOptions {
  cursor?: CaveConversationEventCursor;
}
```

`CaveConversationMessage` gains only additive optional provenance:

```ts
operationId?: CaveConversationOperationId;
retryOfTurnId?: string;
```

The client methods are:

```ts
client.createConversation(request, options?)
client.sendConversationMessage(conversationId, request, options?)
client.retryConversationTurn(
  conversationId,
  { operationId, retryOfTurnId },
  options?,
)
client.getConversationOperation(operationId, options?)
client.streamConversationOperation(operationId, options)
client.stopConversationOperation(operationId, options?)
```

`retryConversationTurn` is a typed convenience over `messages.send`; it does
not introduce a second producer route.

Transport methods remain optional so an older custom transport continues to
satisfy `CaveTransport`. Missing methods fail with `unsupported_operation`.
There is no `request(path, init)` method.

### 5.1 IDs that must remain distinct

- `operationId` is the caller-supplied UUID that identifies one logical
  mutation and its idempotency record.
- envelope `requestId` remains an optional per-HTTP-attempt correlation value.
- Chat's native `op1-...` attempt IDs remain local cancellation tokens.
- Cave private-chat `runId` remains private implementation state.
- pagination `PageCursor` remains a canonical-read cursor.
- an event cursor resumes one conversation operation and cannot be used as a
  page cursor.

The SDK validates operation IDs with the existing Client v1 UUID contract:
exactly 36 characters and the current RFC-compatible UUID pattern. Cave
normalizes accepted UUIDs to lowercase before key lookup so case variants
cannot claim two operations.

Every successful mutation result contains the operation ID. After a valid
operation ID has been accepted by the SDK, every local, transport, and
application error from that mutation also exposes it as optional
`CaveClientError.operationId`. Malformed operation IDs are rejected without
echoing the untrusted value.

## 6. Canonical create semantics

`createConversation` accepts only:

- the operation UUID;
- one canonical familiar ID;
- an optional canonical project ID.

Cave resolves project roots, familiar bindings, harnesses, runtimes, default
titles, and origin/provenance internally. The caller cannot send a filesystem
path, harness command, runtime URL, model-provider payload, origin marker, or
prebuilt transcript.

The successful transaction:

1. authorizes `conversations:write`;
2. validates the full request;
3. claims the operation ID and request hash;
4. chooses the conversation ID;
5. persists the empty canonical conversation with an internal
   `createdByOperationId`;
6. marks the operation completed;
7. returns the recorded create result.

Steps 3 through 6 must be recoverable as one logical transaction. If Cave finds
the conversation marker after a crash but the operation index is incomplete,
startup recovery reconstructs the completed operation rather than creating a
second conversation.

Create does not start an executor and does not open an event stream.

## 7. Send and explicit retry semantics

### 7.1 New text send

A text send:

1. authorizes `chat:write`;
2. validates the conversation and exact UTF-8 text;
3. requires the conversation to remain canonical, writable, and free of
   another nonterminal message operation;
4. claims the operation;
5. persists a new user turn carrying the operation ID;
6. allocates the output assistant-turn ID;
7. emits `operation.accepted`;
8. durably changes the operation to `running` before executor dispatch;
9. emits assistant deltas;
10. persists the terminal assistant turn;
11. emits exactly one terminal event.

The text must be non-empty after trimming but is otherwise preserved byte for
byte. Cave does not Unicode-normalize or trim the persisted text. The request
hash therefore distinguishes whitespace or normalization variants.

The send response is an acceptance/result envelope, not the output stream.
Callers attach with `streamConversationOperation`.

Only one nonterminal message send or retry may own a conversation at a time.
The check and claim occur under the same conversation lock. A different
operation receives `conflict / conversation_busy`; a duplicate of the owning
operation follows the idempotency matrix. This prevents two credentials or two
tabs from racing the active branch.

### 7.2 Retry

Retry requires:

- a fresh operation UUID;
- `retryOfTurnId`;
- no replacement text.

Cave validates that the referenced turn:

- exists in the named conversation;
- is an assistant turn;
- is terminal and marked `isError` or `cancelled`;
- is the current active leaf;
- has a canonical parent user turn;
- contains no attachment dependency from the deferred #43 authority tier.

If the target is no longer the active leaf, Cave returns
`reconcile_required` with reason `canonical_branch_changed`. If the target is
not failed or cancelled, Cave returns `conflict` with reason
`retry_not_allowed`.

The executor receives the exact canonical parent user content. The retry
request does not resend or modify that content. The new assistant turn is a
sibling under the same user turn, carries both the fresh `operationId` and
`retryOfTurnId`, and becomes the active leaf only when its terminal turn is
persisted.

The fresh operation UUID must differ from the operation that produced the
failed/cancelled turn. Repeating the retry request with the retry operation's
own UUID is normal idempotent replay; reusing the source operation UUID is a
conflict.

Generic regenerate, prompt editing, and retrying a successful answer are not
part of this contract.

## 8. Persistent idempotency and request hashes

### 8.1 Record identity

The idempotency key is:

```text
(credentialId, lowercase(operationId))
```

This prevents one paired credential from probing or controlling another
credential's operation. Re-pairing does not silently transfer operation
ownership.

### 8.2 Canonical request hash

After authorization, canonical ID validation, and route-specific validation,
Cave computes:

```text
base64url(
  SHA-256(
    JCS({
      version: 1,
      operation: "<operation id>",
      target: { ...canonical route identifiers },
      input: { ...exact accepted logical input }
    })
  )
)
```

The operation UUID is not part of the hash because it is the record key.
Bearer material, HPKE material, request nonce, timestamps, headers, transport
attempt IDs, and envelope `requestId` are excluded. Defaults that affect the
mutation are resolved before hashing.

For text sends the exact text is hashed. For retry, only the canonical
`retryOfTurnId` is input; copied prompt content is not duplicated into the
request or idempotency record.

The hash is never returned to the consumer and is never printed in ordinary
logs or diagnostics.

### 8.3 Durable record

The operation/idempotency store contains only:

```text
version
credentialId
operationId
operation kind
request hash
internal phase
public state
conversation/input/output/retry turn IDs
created/updated/terminal timestamps
latest event ID and replay floor
fixed failure code
recorded result metadata
retention timestamps
```

It contains no prompt, assistant text, attachment, bearer, pairing secret,
HPKE key, arbitrary cause, stack, command output, tool payload, or environment
value.

The event journal is separate because it necessarily contains assistant text
deltas. It is owner-only, bounded, short-lived, and never copied into audit
records.

### 8.4 Duplicate matrix

| Existing record | Same request hash | Different request hash |
| --- | --- | --- |
| Safe pre-dispatch claim | The single claim owner may continue; a concurrent caller receives the current recorded state. | `conflict / idempotency_key_reused` |
| Accepted/running/stopping | Return current operation; never start another executor. | `conflict / idempotency_key_reused` |
| Completed/failed/cancelled | Replay the recorded result with `replayed: true`. | `conflict / idempotency_key_reused` |
| Result metadata compacted to tombstone | `reconcile_required / idempotency_result_expired`; never execute again. | `conflict / idempotency_key_reused` |

Claims must be linearizable. Concurrent duplicates execute at most once across
threads and processes.

Full terminal result metadata is retained for seven days. It then compacts to a
content-free tombstone retained for the lifetime of the Cave installation.
Expiry never turns an old UUID back into a reusable key. A full Cave-home reset
is a new authority and requires rediscovery and pairing.

## 9. Crash and restart semantics

Cave must persist an internal phase boundary before any irreversible executor
dispatch:

```text
claimed -> accepted -> dispatching/running -> stopping? -> terminal
```

`claimed` and `dispatching` are internal; consumers see the public states in
section 5.

Startup recovery follows this table:

| Durable evidence | Recovery |
| --- | --- |
| Claim exists; no conversation marker or executor dispatch marker | Keep a safe pre-dispatch claim. Only an explicit same-hash resubmission may continue it. |
| Create marker exists; operation result incomplete | Reconstruct completed create from the canonical conversation. |
| User turn exists; dispatch never began | Persist a failed assistant turn with fixed code `authority_restarted_before_dispatch`; mark failed. |
| Dispatch may have begun; no canonical terminal assistant turn | Persist available partial output, then a failed assistant turn with fixed code `authority_restarted_during_execution`; never redispatch. |
| Durable Stop intent exists; no terminal turn | Persist cancellation and mark cancelled; never redispatch. |
| Canonical terminal turn with operation marker exists; operation record is incomplete | Reconstruct the matching terminal operation and terminal event. |

The operation and canonical turn IDs make recovery evidence-based rather than
time-based. Every boundary requires injected crash tests before and after the
durable write.

An ambiguous HTTP completion never causes the SDK or Cave to submit a second
mutation automatically. The consumer may inspect the operation ID. If it needs
new execution after a terminal failure/cancellation, it uses
`retryOfTurnId` and a fresh UUID.

## 10. Typed event stream

### 10.1 Event ordering

Event IDs are positive safe integers, contiguous from `1`, and strictly
increasing per operation. Cave assigns and persists the ID before an event can
be returned.

The ordering guarantees are:

1. `operation.accepted` is event `1` and is emitted only after the canonical
   input turn is durable.
2. zero or more `assistant.delta` events follow;
3. `operation.stopping` appears at most once and only after Stop intent is
   durable;
4. exactly one terminal event appears last;
5. a terminal event is emitted only after the canonical terminal assistant
   turn is durable.

Heartbeat/empty long-poll responses are transport activity, not events and do
not consume IDs.

### 10.2 Cursor

Every event carries a route-specific opaque base64url cursor no longer than the
existing 512-character cursor limit. The producer payload is:

```json
{"v":1,"o":"<lowercase operation UUID>","e":42}
```

The route validates canonical base64url encoding, exact keys, version,
operation match, and event ID. Malformed cursors return `invalid_request`.

`GET .../events?cursor=<cursor>&limit=<1..100>&waitMs=<0..25000>` returns only
events with a greater event ID. Without a cursor it begins at event `1`.

### 10.3 Retention and replay gaps

While an operation is live, Cave retains the newest events up to both 1 MiB and
10,000 events. After terminal state, the retained event journal expires after
24 hours. The operation record and canonical transcript outlive the journal.

If the supplied cursor precedes the replay floor, names another operation, or
names an expired journal, the route returns:

```json
{
  "code": "reconcile_required",
  "retryable": false,
  "details": {
    "reason": "replay_gap"
  }
}
```

It does not emit a synthetic progress event and does not start from the oldest
remaining delta.

### 10.4 One translator

The SDK has one parser/translator for event pages. Initial attachment and every
resumed long poll pass through it.

The translator:

- validates the shared Client v1 envelope before event data;
- validates the operation ID on every event;
- requires contiguous increasing event IDs;
- suppresses an exact duplicate event at or below the caller's accepted
  cursor;
- treats a forward gap, reordered event, changed operation ID, malformed
  terminal sequence, or event after terminal as `invalid_response`;
- yields immutable typed events in wire order;
- updates the resume cursor only after yielding the corresponding event.

`OperationOptions.timeoutMs` is one total stream budget. Each long poll receives
only the remaining budget. A caller abort closes the current event read and the
generator. It does not call Stop and does not resubmit send.

## 11. Stop semantics

Stop targets only an operation UUID. There is no conversation-ID fallback.

The route:

1. authorizes `chat:write`;
2. verifies operation ownership by credential;
3. persists Stop intent;
4. emits `operation.stopping` if the operation was active;
5. signals the canonical executor;
6. returns the resulting operation state.

Repeated Stop calls are naturally idempotent against the target operation:

- active operation: return `stopping`;
- completed/failed/cancelled operation: return the existing terminal state with
  no mutation;
- unknown or foreign operation: return `not_found` without revealing which.

`cancelled` is not reported until the executor is settled and the canonical
cancelled assistant turn is durable. A race in which completion wins returns
`completed`; Stop does not rewrite a completed answer as cancelled.

The SDK does not automatically retry a Stop POST after ambiguous transport
completion. Calling Stop again explicitly is safe.

## 12. Reconciliation

`reconcile_required` is an instruction to reload authority state, not a
transient transport retry.

Defined reasons for #42 are:

- `replay_gap`;
- `operation_expired`;
- `canonical_branch_changed`;
- `idempotency_result_expired`;
- `canonical_state_moved`.

On this error a consumer:

1. stops rendering the incomplete stream as continuous;
2. reads `operations.read`;
3. reloads `getConversation`;
4. reloads `listConversationMessages` from the first page;
5. replaces, rather than appends to, its local projection;
6. waits for terminal operation state when canonical output is not yet
   available.

The SDK never fabricates omitted deltas. Chat keeps reconciliation in its query
and mutation adapters; it does not turn it into a global disconnected
connection state.

## 13. Security, audit, and redaction

### 13.1 Authority and authorization

- Every route is direct-loopback Client v1 ingress and HPKE-authority-bound
  when active.
- Create requires `conversations:write`.
- Send, operation read/events, and Stop require `chat:write`.
- Existing `chat:read` remains sufficient only for canonical reads.
- A stored read-only credential is never silently widened. Chat and CLI must
  request new scopes through explicit pairing consent.
- Operation ownership is checked before result, event, or Stop lookup details
  can escape.
- Mutation and event-poll rate limits are separate from ordinary read limits.

### 13.2 Content boundaries

- The idempotency/operation ledger stores request hashes and result metadata,
  not request or response content.
- The short-lived event journal stores only public event DTOs. It contains no
  tool input/output, reasoning, provider envelope, raw command output, runtime
  URL, filesystem content, or arbitrary exception message.
- `assistant.delta` text is intentional conversation content. It may reach the
  paired consumer but never lifecycle observers, audit records, diagnostic
  bundles, or ordinary logs.
- Retry reads prompt content from the canonical transcript; it does not copy
  the prompt into the retry request or audit record.
- Owner-only permissions, bounded writes, atomic replacement, and startup
  corruption refusal apply to every new durable store.

### 13.3 Audit record

Cave writes a fixed-schema audit record for claim, conflict, dispatch, Stop,
terminal state, retry, replay-gap, and recovery:

```text
timestamp
credentialId
operationId
operation kind
conversationId
input/output/retry turn IDs
request hash
phase/outcome code
event ID range
recovery reason
```

The audit record contains no prompt, assistant text, attachment data, bearer,
pairing secret, HPKE material, stack, cause, environment, argv, or command
output. Audit rendering uses an allowlist, not recursive serialization of an
error or request object.

### 13.4 SDK and CLI redaction

- `CaveClientError` retains a local cause only under the existing sensitive
  cause policy.
- Normalized errors and operation observers receive fixed code, operation name,
  operation ID, request ID, status, retryability, and duration only.
- Redaction occurs before human, JSON, or NDJSON selection.
- Accessors, proxies, prototypes, cycles, huge arrays, and secret-shaped keys
  are refused or reduced before output.
- The CLI never accepts prompt text in argv, where it would enter shell
  history. Streaming commands read message content from stdin or another
  explicitly opened input stream.

## 14. Private CLI output ordering

The CLI remains private and excluded from the read-only release package set.
Its #42 commands consume public SDK methods and the same event translator.

One serialized writer owns all output for a streaming command. Event callbacks
never call `console.log` concurrently.

### Human

After a valid send is accepted, stdout order is:

1. one operation-ID line;
2. assistant delta text in event order;
3. one newline if the final delta did not end with one;
4. one fixed terminal line: completed, failed with safe code, or cancelled.

An error before acceptance uses the existing stderr failure contract. An error
after acceptance remains on stdout so previously streamed stdout cannot be
reordered across file descriptors. The process exit code still reports
failure.

### JSON

JSON mode buffers sanitized public events and emits one final object whose
`events` array is in event-ID order. It includes operation and terminal
metadata and excludes `human`, cause, stack, and private details. The buffer is
limited to 8 MiB. On overflow the CLI closes only its event read and emits one
ordered `output_limit` result containing the operation ID and last accepted
cursor; the Cave operation continues.

### NDJSON

NDJSON emits:

1. one accepted operation record;
2. one line per typed event in event-ID order;
3. one terminal summary record.

All records go to stdout. The writer awaits backpressure before consuming the
next SDK event. A terminal error is data plus a nonzero exit code, not an
out-of-band stack trace.

## 15. Ownership

### Cave producer

Cave owns:

- the five Client v1 operation records and routes;
- generated contract fixture and documentation;
- HPKE protected-operation registration;
- canonical request hashing;
- linearizable persistent idempotency;
- operation and event stores;
- crash recovery;
- shared conversation execution service;
- Stop and retry validation;
- canonical transcript writes and active-leaf movement;
- audit and producer redaction;
- real-authority fault injection.

The current private route handlers may be refactored to call a shared
conversation service. Client v1 must not fetch or internally proxy the private
routes, and it must not expose their request or event types.

### SDK

The SDK owns:

- exact fixture provenance and digest verification;
- public DTOs, validators, and immutable parsers;
- constrained optional transport methods;
- direct and managed-native client methods;
- operation-ID propagation on errors;
- one initial/resume event translator;
- duplicate suppression and protocol-order refusal;
- no-retry mutation behavior;
- public API baselines;
- packed examples and consumer tests;
- private CLI rendering.

The SDK owns no durable idempotency, operation journal, replay buffer,
canonical transcript, executor, or Stop registry.

### Chat

Chat owns:

- explicit re-pairing for write scopes;
- exact Tauri commands for the new constrained SDK transport;
- bearer custody outside JavaScript;
- native request/response size and cancellation enforcement;
- generation of a fresh UUID before each create/send/retry;
- product mutation state and Stop controls;
- stream cursor retention for the active UI;
- canonical query invalidation and replacement on reconciliation;
- supported-platform native evidence.

Chat does not duplicate Client v1 schemas, hash requests, persist idempotency,
call private Cave routes, reinterpret abort as Stop, or invent a second
conversation database.

## 16. Dependency-ordered PR plan

1. **Finish the read-only gate.** #41 remains the blocker. #27/#38/#40 evidence
   and disposition must be durable.
2. **Cave storage/service PR.** Add the operation/idempotency/event stores,
   canonical request hash, crash recovery, and a shared executor-facing
   conversation service. Do not advertise Client v1 operations yet.
3. **Cave contract/routes PR.** Add the five routes, operation registry
   entries, scopes, capability families, protected-operation entries, exact
   limits, generated fixture, docs, route bijection tests, and real-authority
   producer tests. This PR produces the exact commit the SDK vendors.
4. **SDK direct-client PR.** Import that exact fixture; add types, parsers,
   direct transport methods, client methods, event translator, operation-ID
   errors, API baselines, packed examples, and no-auto-retry tests.
5. **SDK managed-native/private-CLI PR.** Extend only the constrained managed
   transport and add ordered CLI renderers. No generic native request method.
6. **Chat native/product PR.** Add exact Rust/Tauri commands, explicit
   write-scope pairing, mutation controller, Stop/retry UI, and reconciliation.
7. **Cross-repository conformance PRs.** Pin exact Cave, SDK, and Chat commits
   and artifact digests; run the full matrix on all three frozen platforms.
8. **Authority-level security review.** Review the exact final commits,
   retained evidence, and public packages before any release authorization.

Operational capabilities are advertised only in step 3, when all named routes
and their storage authority are live. An SDK PR must not land first with
speculative route paths.

## 17. Test and conformance matrix

| Layer | Required evidence |
| --- | --- |
| Cave contract | Route/registry/fixture/doc bijection; scopes; capability truth; protected-operation list; limits; additive Client v1 compatibility. |
| Request validation | UUID case normalization; exact text byte bound; invalid/foreign IDs; exactly one of text or `retryOfTurnId`; no unknown fields; canonical request hash vectors. |
| Idempotency | Same key/same hash at every phase; same key/different hash conflict; concurrent duplicate claims execute once; terminal result replay; seven-day compaction; lifetime tombstone refusal. |
| Crash recovery | Inject failure before/after claim, input-turn persistence, dispatch marker, executor launch, Stop persistence, terminal transcript write, terminal event write, and tombstone compaction. |
| Create | Duplicate create produces one conversation; restart reconstructs result; caller cannot supply root/runtime/harness/origin/transcript. |
| Send | Accepted event follows durable input turn; one executor launch; terminal event follows durable assistant turn; partial output is retained on failure/cancel. |
| Conversation serialization | One nonterminal send/retry per conversation; same-operation duplicate replay; different-operation `conversation_busy`; cross-credential race. |
| Retry | Only failed/cancelled active-leaf assistant turns; fresh operation UUID; source operation UUID refusal; exact canonical prompt reuse; no retry of successful/running/foreign/attachment-bearing turn. |
| Stop | Before registration, during execution, after completion, concurrent completion race, repeated Stop, unknown/foreign operation, restart with durable Stop intent. |
| Events | Contiguous IDs; per-event cursors; initial/resume parity; duplicate suppression; empty long poll; bounded page; byte/count/time eviction; cursor-operation mismatch; replay gap. |
| SDK | Hostile envelopes, accessors, prototypes, cycles, unknown events, reordered events, event after terminal, operation ID on every post-validation error, optional old transports, total timeout, abort closes read only. |
| Managed native | Exact command allowlist; no bearer in webview; body/event bounds; native cancellation; hostile result snapshots; no generic URL/path/headers bridge. |
| CLI | Human/JSON/NDJSON golden ordering; split UTF-8 chunks; stdout backpressure; terminal failure after output; no prompt argv; secret/cause/stack redaction. |
| Packed consumer | Exact tarball install; type-only and runtime use; direct transport example; managed-browser example; no workspace/source-relative imports. |
| Chat | Scope-upgrade consent; create/send/resume/Stop/retry; restart; revoked credential; instance replacement; query invalidation; no browser storage or diagnostic content leak. |
| Real authority | Duplicate send under transport loss; Cave restart at every phase; replay retention gap; canonical branch move; exact artifact digests; stable assertion IDs; no skip counted as pass. |
| Platform | Passing immutable evidence on `darwin-arm64`, `linux-x64`, and `win32-x64`. |
| Security | Separate review of authority binding, content duplication, local store permissions, operation enumeration, rate limits, audit/redaction, and release artifact exposure. |

The conformance record must add mutation assertion IDs to a declared complete
set and fail on missing, duplicate, unexpected, or skipped-required
assertions.

## 18. Compatibility

- Client v1 remains `apiVersion: "1.0"` because the change is additive.
- Existing reads, page cursor meanings, DTO fields, and read scopes do not
  change.
- Old SDKs ignore unknown capability and operation declarations within their
  bounded parser rules.
- Old custom transports remain valid because new transport methods are
  optional; invoking absent methods yields `unsupported_operation`.
- New `CaveConversationMessage` fields and
  `CaveClientError.operationId` are optional.
- `requestId` is not redefined.
- `reconcile_required` remains the canonical instruction to reload, not a
  license to retry a mutation.
- Consumers with `chat:read` only continue to read. They must explicitly
  re-pair for `chat:write` and/or `conversations:write`.
- This is a minor SDK authority tier greater than the read-only release. This
  spec does not authorize or name a registry version.

## 19. Non-goals

- conversation update, title mutation, branch-selection mutation, or delete;
- attachments or attachment-bearing retry;
- model, reasoning, speed, permission, host, harness, runtime, or provider
  controls;
- generic regenerate or edit-and-rerun;
- tool invocation contracts or tool input/output stream events;
- arbitrary HTTP paths, headers, methods, or private-route bridging;
- direct use of `/api/chat/send`, `/api/chat/stream`, or `/api/chat/stop`;
- SSE/WebSocket or a new HPKE streaming cipher;
- automatic mutation retry after timeout, abort, disconnect, 5xx, or restart;
- abort-as-Stop;
- offline mutation queues or travel replay;
- GitHub, task, attention, or rich-content mutations;
- public release of `@opencoven/dev-cli`;
- release authorization or publication.

## 20. Completion bar for #42

#42 is complete only when:

- Cave has one reviewed, generated, source-locked mutation contract;
- persistent idempotency and restart fault injection pass;
- create/send/stream/Stop/retry/reconcile pass through public SDK APIs;
- direct and managed-native packed consumers pass;
- Chat uses the SDK without exposing bearers or duplicating protocol logic;
- the three-platform real-authority mutation matrix passes;
- retained evidence passes content and secret scans;
- a separate exact-commit security review approves the new authority tier.
