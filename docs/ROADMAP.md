# OpenCoven SDK Roadmap

Current conformance checkpoint: the lock binds Chat #305 at
`1f69306293f8caf873e0a2d6459a5c402e77600a` with bounded isolation diagnostics. The new SDK binding
requires verified landing, both validator-scope rotations, and fresh protected
validation. Prior run `35111662551` tested Chat #297 and SDK #290: Linux/macOS
records independently passed all 197 assertions each, identities, timing, and
privacy scans. Windows failed the generic isolation invariant and uploaded no
record; validation, attestation, and aggregation were skipped. No aggregate is
accepted. SDK #38 acceptance and SDK #45 consolidation remain open. See the
[exact binding and validation record](workflows/client-v1-cross-repository-conformance.md).

The OpenCoven SDK is experimental and unpublished. The current objective is a secure read-only **0.0.1** release that proves discovery, consent, identity, credential custody, canonical reads, native trust, and packed-consumer behavior before adding mutation authority.

The [0.0.1 release decision](../RELEASING.md#v001-preparation-decision-2026-09-12)
replaces the original 0.1.0 version target, not its scope or acceptance gates.
The dated 0.1 design and delivery program below retain their historical names.

For the complete design and execution graph, see:

- [0.1 read-only release design](superpowers/specs/2026-08-22-sdk-0.1-read-only-release-design.md)
- [0.1 dependency-ordered delivery program](superpowers/plans/2026-08-22-sdk-0.1-delivery-program.md)
- [GitHub program issue #31](https://github.com/OpenCoven/sdk/issues/31)

## Current state

Delivered foundations include:

- transport-neutral package boundaries;
- explicit caller-supplied transports;
- no import-time discovery or I/O;
- normalized errors, deadlines, cancellation, and observers;
- secure owner-local Coven discovery and health transport contracts;
- strict Cave Client v1 one-page canonical reads and bounded lazy iterators
  merged through SDK PR #55;
- contract fixture verification;
- property, stress, package, and packed-consumer tests;
- a locked two-key release system with checksummed artifacts and OIDC-oriented publishing.

All workspace packages remain private and public publishing remains
intentionally disabled. The 0.0.1 release inventory contains the four SDK
libraries; `@opencoven/dev-cli` remains a source-tested private workspace and
is excluded from release artifacts and the Changesets fixed group.

SDK [#35](https://github.com/OpenCoven/sdk/issues/35) merged through PR #69 at
`163961f4e59cfdef51d2271fa98e7c514977203f`. It adds strict discovery v2 plus
`hpke-bound-v1`, and the upstream producer/runtime authority boundary landed in
[`OpenCoven/coven-cave#5044`](https://github.com/OpenCoven/coven-cave/pull/5044)
and closed
[`OpenCoven/coven-cave#4996`](https://github.com/OpenCoven/coven-cave/issues/4996).
The original pairing milestone used Cave authority
`6325fc4c1154c7d7398074a9760a2e2dc323b424`; it is not the current release
authority. The current source and artifact identities are pinned in
[`conformance/client-v1-cross-repository-lock.json`](../conformance/client-v1-cross-repository-lock.json)
and [the release process](../RELEASING.md#v001-preparation-decision-2026-09-12).
Issue #35 is closed after
[OpenCoven/chat#30](https://github.com/OpenCoven/chat/pull/30) and
[Actions run `33250233035`](https://github.com/OpenCoven/chat/actions/runs/33250233035)
completed the packaged `darwin-arm64` pairing/custody matrix, including
secure-store failure/retry, restart reuse, revocation, ambiguity handling, and
retained evidence secret scanning.

SDK [#36](https://github.com/OpenCoven/sdk/issues/36) merged through PR #55 at
`d7f9e69378d6136c2771f60b4c57d7beeaa74f6a`. It exposes five one-page reads
(`listFamiliars`, `listProjects`, `listConversations`, `getConversation`, and
`listConversationMessages`) plus four bounded list iterators; it has no detail
iterator. Limits default to `50`, reject unsafe or out-of-range values above
the maximum `100`, and use opaque strict canonical base64url cursors bounded to
512 characters. Iterators require positive `maxPages` or a caller-owned signal
and never prefetch, retry, or implicitly walk the whole corpus.

SDK [#37](https://github.com/OpenCoven/sdk/issues/37) records that the private
CLI is deferred from the first release and that Chat's Tauri layer owns the
Phase 1 native trust adapters. The native Chat/real-authority conformance matrix is
frozen to `darwin-arm64`, `linux-x64`, and `win32-x64`. Chat
[#27](https://github.com/OpenCoven/chat/issues/27) is closed after the native
integration landed. OpenCoven/chat#30 and Actions run `33250233035` provide
the first named packed real-authority record for `darwin-arm64`. That historical
record does not qualify the new 0.0.1 candidate.

The private 0.0.1 candidate is frozen at
`96804bc483a063e41e9a9738a4ace61970f6c0a4`. The source lock above is authoritative
for the current producer and counterpart identities. On 2026-09-15, SDK [#276](https://github.com/OpenCoven/sdk/pull/276)
landed as `6b4e0d04e168c7ccd99df492a0494e223150e2ab` with the verified
Chat #293 binding. Both validator scopes were rotated and read back at that
actual merge. Protected [run 34951851914](https://github.com/OpenCoven/chat/actions/runs/34951851914),
attempt 1, was dispatched with Chat `6fa5dab5` and SDK #276. Its frozen workflow
and supervisor artifact passed independent authentication before environment
approval. Linux and macOS passed independent record identity, Cave timing,
scan, and all 197 ordered assertion checks each. Windows failed at
`phase1.native-scenarios.native-preflight-installation-rpc`, during
`app_installation_id` and before the installation-ID assertion. It published
no record; validation, attestation, and aggregation were skipped. This is
terminal partial evidence, not aggregate acceptance or publication approval.
The RPC's underlying failure remains unclassified; the stage does not prove
a recurrence of the earlier quota-monitor cause.

The prior SDK #275 run `34945048615` is terminal failure: Linux and macOS
records passed independent inspection, while Windows published no record and
failed its bounded checkout directory quota monitor. Downstream attestation
and aggregation were skipped. The [#38 checkpoint](https://github.com/OpenCoven/sdk/issues/38)
tracks subsequent platform records and exact aggregate acceptance.

SDK [#277](https://github.com/OpenCoven/sdk/pull/277) separately delivered
per-client discovery v2 retention, concurrent current-credential preservation,
and snapshots used to pin pairing authority. That development-source change is
not included in frozen candidate `96804bc4` or validated by the SDK #276 run.
The retained HPKE branch still requires managed/retry reconciliation under
[#45](https://github.com/OpenCoven/sdk/issues/45). Candidate and counterpart
authorities remain frozen; a later candidate needs its own review and evidence.

Historical candidate77 protected
[run `34796638173`, attempt 1](https://github.com/OpenCoven/chat/actions/runs/34796638173/attempts/1)
produced [authenticated partial Unix records](https://github.com/OpenCoven/sdk/issues/38#issuecomment-5659174495),
but Windows failed and downstream validation, attestation, and aggregation
were skipped. A closed issue or successful ordinary CI does not satisfy this
gate. See the [dated release checkpoint](../RELEASING.md#release-gate-checkpoint-2026-09-14)
for the remaining evidence and authorization requirements.

## Now: secure read-only 0.0.1

### Contract truth

- [#32](https://github.com/OpenCoven/sdk/issues/32) — reconcile release scope and current plans
- [Cave #4869](https://github.com/OpenCoven/coven-cave/issues/4869) — make capabilities operationally truthful
- [#33](https://github.com/OpenCoven/sdk/issues/33) — source-lock the Cave contract and correct health compatibility

### Protocol

- [#34](https://github.com/OpenCoven/sdk/issues/34) — secure Cave discovery
- [#35](https://github.com/OpenCoven/sdk/issues/35) — pairing and credential
  custody; closed after strict discovery v2 + `hpke-bound-v1` merged through
  PR #69 and the packaged `darwin-arm64` pairing/custody evidence passed
- [#36](https://github.com/OpenCoven/sdk/issues/36) — canonical reads merged through PR #55
- [#37](https://github.com/OpenCoven/sdk/issues/37): defer the private CLI from the first release; assign Phase 1 native trust adapters to Chat

### Consumer and evidence

- [Chat #27](https://github.com/OpenCoven/chat/issues/27) — packed SDK/native
  integration complete
- [#38](https://github.com/OpenCoven/sdk/issues/38): cross-repository
  real-authority conformance; the 0.0.1 candidate has partial Unix evidence,
  but Windows and the complete authenticated aggregate remain required
- [#39](https://github.com/OpenCoven/sdk/issues/39) — profiles, diagnostics, and public API governance

### Release

- [#40](https://github.com/OpenCoven/sdk/issues/40) — security review and
  ship/block disposition; remains BLOCK until the exact final candidate is
  re-reviewed
- [#41](https://github.com/OpenCoven/sdk/issues/41) — release execution and
  registry/provenance validation; locked, packages private, publishing disabled

## Next — conversational control

[#42](https://github.com/OpenCoven/sdk/issues/42) adds the first bounded mutation tier. Its
[implementation-ready design](superpowers/specs/2026-08-28-sdk-conversational-control-design.md)
is complete; implementation remains blocked by #41 and the unbuilt Cave Client
v1 mutation authority.

- canonical conversation creation;
- persistent idempotency;
- send;
- resumable typed streaming;
- stop and retry;
- canonical reconciliation after replay gaps.

Ambiguous mutations are never automatically replayed.

## Later — rich authority

[#43](https://github.com/OpenCoven/sdk/issues/43) covers:

- bounded attachments;
- passive rich-content semantics;
- attention responses;
- task handoffs;
- explicitly confirmed, scope-checked GitHub mutations.

Every privileged action remains constrained, idempotent, auditable, and revalidated by Cave.

## Later — offline reads and advanced tooling

[#44](https://github.com/OpenCoven/sdk/issues/44) covers:

- encrypted replaceable offline read cache;
- completions;
- fixed safe scaffolds;
- expanded redacted diagnostics;
- packed examples and native-boundary guidance.

Offline mode remains read-only and never becomes a second canonical database.
The [implementation design](superpowers/specs/2026-08-28-sdk-offline-reads-and-tooling-design.md)
requires real producer revisions and keeps the CLI private unless a separate
distribution gate is approved.

## Future — Coven Automations

[#80](https://github.com/OpenCoven/sdk/issues/80) adds a constrained Automations
SDK consuming canonical `coven.automations.v1` artifacts.
[OpenCoven/coven#855](https://github.com/OpenCoven/coven/issues/855) is closed:
the immutable base-artifact canary landed in SDK #106. The canary now also
independently recomputes golden definition/receipt integrity and checks the
receipt's definition binding before exercising replay vectors. This is
constrained contract conformance, not a public receipt-authentication API.

The standalone Automations client on SDK main discovers capabilities and exposes
seven allowlisted reads: `list()`, `get()`, `health()`, `runs()`, `occurrences()`,
`getOccurrence()`, and `getReceipt()`. Authenticated Unix socket and Windows
named-pipe transports use the source-pinned `POST /api/v1/actions` surface.
Reads require their exact advertised action; receipt retrieval does not
independently authenticate receipt identity, authority, or outcome claims.
The [package contract](../packages/coven/README.md#automations-phase-1-capability-discovery-and-diagnostic-reads) describes the
read projections and native-adapter requirements. These APIs on main do not
recapture the frozen `96804bc` release candidate. Normative rich definitions,
pagination, subscriptions, independent receipt verification, mutations, and
authority acceptance remain outside these reads.

OpenCoven/coven#991 (`d277ade3`) and OpenCoven/coven#999 (`735e2f05`) publish packaged base capability
negotiation, durable `CAPABILITY_UNSUPPORTED` outcomes, and exact wire request
fingerprinting. The rich normative `AutomationDefinition` remains
negotiation-only. Read/verify/subscribe implementation can progress against
committed producer surfaces without treating certification as a blanket gate;
remaining individual-run retrieval/subscription APIs, production lifecycle emission, rich
executable persistence, command-catalog parity, and current packed
cross-repository certification are not credited as complete.
Authority-bearing commands remain additionally blocked by
[OpenCoven/coven#857](https://github.com/OpenCoven/coven/issues/857) and
[OpenCoven/coven#858](https://github.com/OpenCoven/coven/issues/858).

Automations are not part of the 0.0.1 release bar. The SDK will consume pinned
Coven-owned contracts and evidence rather than defining scheduling, authority,
or run state independently.

## Parallel maintenance

[#45](https://github.com/OpenCoven/sdk/issues/45) audits legacy branches, worktrees, and stash state. Cleanup is separately authorized and does not block 0.0.1 unless unique work or release/provenance risk is discovered.

## 0.0.1 release bar

The first release does not ship until all of the following are true:

- the SDK fixture matches a named Cave producer commit;
- compatibility health and capability declarations are truthful;
- discovery, pairing, credential custody, and canonical reads work from packed artifacts;
- Coven IPC trust uses live connected-peer or pipe identity;
- Chat completes the journey through native custody and trust adapters;
- SDK and Chat are removed from conformance `notCovered`;
- the frozen native conformance matrix has one passing record each for
  `darwin-arm64`, `linux-x64`, and `win32-x64`, bound to the same accepted
  candidate and authenticated through the complete protected evidence chain;
- the accepted aggregate and its reviewed index are committed and selected by
  `conformanceEvidence.aggregateRecord` in `release.config.json`;
- public API baselines and redacted diagnostics are complete;
- the security review authorizes the exact publication artifacts, annotated
  tag object, and protected environment policy, not merely the private
  conformance candidate;
- registry bytes and provenance match the reviewed release manifest;
- bootstrap credentials are revoked;
- ordinary future publishing uses protected OIDC with no token fallback.
