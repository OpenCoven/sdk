# OpenCoven SDK Roadmap

Conformance checkpoint, 2026-09-22: this binding selects Chat #358 producer
`8be8d09a3a3119ad3bc4df91652ad5ab6c45b701`, the merge that repins Chat's harness
authority to `3877057ffc6ba5d9dc22e6062bae9f0c32478f28` after the Windows
`MAX_PATH` repair in [Chat #348](https://github.com/OpenCoven/chat/pull/348).
Its reviewed head has the same complete tree, and the harness authority is that
head's sole parent. Chat `main` equals the producer commit at binding time.
SDK [#310](https://github.com/OpenCoven/sdk/pull/310) delivered the binding at
`1ad0dae0e09df37a42df11be5d0329ffc20f567e`; all merged-main checks passed, and
both validator scopes read back that revision. Protected
[run 35704479061](https://github.com/OpenCoven/chat/actions/runs/35704479061)
completed with failure for this exact pair. Linux and macOS records passed
the committed validators and all 197 assertions each; Windows failed at
`phase1.stage.evidence-authority.build.failed`, in schema-v2 evidence assembly.
No Windows record exists; validation, attestation and aggregation were skipped.
The underlying exception remains unclassified. The temporary macOS inspector's extra
upload-step timestamp guard refused; exact artifact identity, digest and
unchanged committed validation passed. No aggregate acceptance is established.

The preceding [SDK #302](https://github.com/OpenCoven/sdk/pull/302) merged at
`1c10e63a9ff87934397e8defc2d0b98f3932abe2`, binding Chat #328 producer
`ac1c4f4ca658fbb03bd2541bf265a57666e80c7c`, with both Chat validator scopes
rotated and read back at that revision.

Protected [run `35566636457`](https://github.com/OpenCoven/chat/actions/runs/35566636457)
is historical and failed. Linux and macOS records
independently passed exact identities, canonical schema, privacy and retained-evidence
scans, Cave timing, and all 197 ordered assertions each (110 Cave, 46 SDK, 41 Chat).
Windows failed at `phase1.packaging.chat-native-build.build-script` and produced
no platform record; artifact validation, attestation, and aggregation were skipped.
That stage is the `aws-lc-sys` build script, whose deepest relative include
overflowed `MAX_PATH` beneath the previous isolated bootstrap root. Chat #348
shortens that root and was verified on a scratch copy of the Windows lane
(deepest include 250 characters, `cargo build` exit 0). The current protected run
reached evidence assembly but did not establish a complete Windows
journey or an accepted aggregate, and the earlier checkout-quota monitor question
remains unanswered by those preceding failed runs, which never reached the monitor.

[SDK #295](https://github.com/OpenCoven/sdk/pull/295) delivered descendant
provenance validation through both collectors at `888358012`. The current
binding remains specific to the reviewed producer; subsequent Chat main
changes require their own provenance review. See the
[binding and validation record](workflows/client-v1-cross-repository-conformance.md).

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

SDK [#299](https://github.com/OpenCoven/sdk/pull/299), merged at `b80fc6d76`,
adds real-HPKE regressions for forged stale guidance while preserving single-use
pairing's no-retry behavior. [#301](https://github.com/OpenCoven/sdk/pull/301),
merged at `09c537753`, adds managed authenticated reads with authority pinned
separately for each iterator. PR-head and merged-main checks passed for both;
[#296](https://github.com/OpenCoven/sdk/issues/296) is closed after both blockers
were delivered. Native adapter adoption remains separate. Candidate and
counterpart authorities stay frozen; a later candidate needs its own review
and evidence.

Historical candidate77 protected
[run `34796638173`, attempt 1](https://github.com/OpenCoven/chat/actions/runs/34796638173/attempts/1)
produced [authenticated partial Unix records](https://github.com/OpenCoven/sdk/issues/38#issuecomment-5659174495),
but Windows failed and downstream validation, attestation, and aggregation
were skipped. A closed issue or successful ordinary CI does not satisfy this
gate. See the [dated release checkpoint](../RELEASING.md#release-gate-checkpoint-2026-09-14)
for the remaining evidence and authorization requirements.

## Now: secure read-only 0.0.1

### Open issue queue, 2026-09-20

Use the GitHub issue graph for active delivery. The historical Beads ledger
is not a current issue-status mirror; see the [plan index](superpowers/plans/README.md).

| Issue | Remaining work and dependency |
| --- | --- |
| [#31](https://github.com/OpenCoven/sdk/issues/31) | Keep the release program open through #38, #40, and #41, including registry verification. |
| [#38](https://github.com/OpenCoven/sdk/issues/38) | SDK #310 delivered the Chat #358 binding; both validator scopes read back `1ad0dae0e`. Run `35704479061` produced Unix records passing committed validators but failed Windows schema-v2 evidence assembly. Diagnose that bounded producer failure and obtain a complete authenticated aggregate. |
| [#40](https://github.com/OpenCoven/sdk/issues/40) | The [security review](workflows/first-release-security-review.md) records BLOCK. Re-review the exact publication candidate after #38 passes. |
| [#41](https://github.com/OpenCoven/sdk/issues/41) | Execute publication only after #40 recommends ship and the maintainer explicitly authorizes each release mutation. |
| [#42](https://github.com/OpenCoven/sdk/issues/42) | Conversational control depends on #41, canonical Cave mutation authority, and real-authority mutation evidence. |
| [#43](https://github.com/OpenCoven/sdk/issues/43) | Rich content and privileged actions depend on #42 and their separately reviewed authority contracts. |
| [#44](https://github.com/OpenCoven/sdk/issues/44) | Offline reads and tooling depend on #41 and approved native cache semantics. |
| [#80](https://github.com/OpenCoven/sdk/issues/80) | Domain event pages and subscriptions shipped in #300. Local receipt integrity and caller-binding verification shipped in #304. Bounded reducer, event-integrity and definition-digest helpers shipped in #305; full guarded transitions remain unreconciled. Missing producer queries and authority-bearing commands have separate upstream gates. |
| [#199](https://github.com/OpenCoven/sdk/issues/199) | Preserve the delivered refusal-only consumer until Coven publishes a reviewed, explicitly negotiated positive admission contract. |

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

## Coven Automations

[#80](https://github.com/OpenCoven/sdk/issues/80) adds a constrained Automations
SDK consuming canonical `coven.automations.v1` artifacts.
[OpenCoven/coven#855](https://github.com/OpenCoven/coven/issues/855) is closed:
the immutable base-artifact canary landed in SDK #106. The canary now also
independently recomputes golden definition/receipt integrity and checks the
receipt's definition binding before exercising replay vectors. This is
constrained contract conformance, not a public receipt-authentication API.

The Automations client on SDK main discovers capabilities and exposes
`list()`, `get()`, `health()`, `runs()`, `occurrences()`, `getOccurrence()`,
`getReceipt()`, and bounded `events()` reads. Authenticated Unix socket and
Windows named-pipe transports use the source-pinned `POST /api/v1/actions` surface.
Reads require their exact advertised action; receipt retrieval does not
independently authenticate receipt identity, authority, or outcome claims.
The [package contract](../packages/coven/README.md#automations-phase-1-capability-discovery-and-diagnostic-reads) describes the
read projections and native-adapter requirements.

[SDK #300](https://github.com/OpenCoven/sdk/pull/300), merged at `dd07e1d45`,
delivered `events()` and demand-driven `subscribe()` pages for automation,
occurrence, and run streams. PR-head and merged-main checks passed. The API
supports explicit checkpoints, duplicate handling, ordering, cancellation,
and bounded pages without polling, prefetch, retry, or implicit cursor reset.
These APIs do not recapture the frozen `96804bc` release candidate.

[SDK #304](https://github.com/OpenCoven/sdk/pull/304), merged at `0cd6e510b`,
delivered local `verifyReceipt()` integrity checks and seven explicit
caller-supplied identity bindings. The reviewed and delivered trees match;
all final PR checks passed, including 2,912 tests in both normal and coverage
runs. Authentication and runtime authority remain explicitly unverified.

[SDK #305](https://github.com/OpenCoven/sdk/pull/305), merged at `49b7ab5e3`,
delivered `reduceAutomationEvents()`, `verifyEventIntegrity()`, and
`computeDefinitionDigest()`. The delivered tree matches the reviewed tree;
all final PR checks passed, including 2,978 tests in both normal and coverage
runs. Occurrence continuity is checked only when prior occurrence state is
available in the current projection. These helpers cannot authenticate a producer or runtime,
and a complete normative definition cannot be reconstructed from `get()`'s
legacy projection. Full guarded transition validation across every stream
remains unreconciled.

An optional global-feed API remains deferred. The producer supports `feed/all`
with a separate page cursor; domain event sequences do not establish feed-wide
ordering. This is separate SDK API design, not a missing producer route.
Individual-run lookup and per-automation occurrence history still lack
supported producer read actions.

[SDK #303](https://github.com/OpenCoven/sdk/pull/303) separately added exact
17-file and released 19-file Automations artifact inventories at `d4cf105df`.
The actual Coven v0.4.4 bundle passed its integrity checks; result-envelope
authentication remains explicitly unperformed.

OpenCoven/coven#991 (`d277ade3`) and OpenCoven/coven#999 (`735e2f05`) publish packaged base capability
negotiation, durable `CAPABILITY_UNSUPPORTED` outcomes, and exact wire request
fingerprinting. The rich normative `AutomationDefinition` remains
negotiation-only. [Coven #1054](https://github.com/OpenCoven/coven/issues/1054)
tracks executable rich persistence, command-catalog parity, and production
lifecycle emission. Current packed cross-repository certification remains
separate from these SDK development increments.
Authority-bearing commands remain additionally blocked by
[OpenCoven/coven#857](https://github.com/OpenCoven/coven/issues/857) and
[OpenCoven/coven#858](https://github.com/OpenCoven/coven/issues/858).

Automations are not part of the 0.0.1 release bar. The SDK will consume pinned
Coven-owned contracts and evidence rather than defining scheduling, authority,
or run state independently.

## Coven session policy

[#199](https://github.com/OpenCoven/sdk/issues/199) has delivered the strict
refusal-only v1 consumer. Its refreshed prerequisite checkpoint records that
[Coven #1083](https://github.com/OpenCoven/coven/pull/1083) merged the macOS
Seatbelt backend at `2c173cf2`. Coven's
[canonical implementation at `14487ac7`](https://github.com/OpenCoven/coven/blob/14487ac7b23fe285db6ff6dd102109b995f58cdc/crates/coven-cli/src/session_policy.rs#L86-L95)
still advertises `enforcement: "unavailable"` and `supported_profiles: []`;
the backend merge does not activate admission.
SDK acceptance and lifecycle support require a separately reviewed negotiated
revision with verified enforcement and the evidence tracked by
[Wand #9](https://github.com/OpenCoven/wand/issues/9) and
[Wand #10](https://github.com/OpenCoven/wand/issues/10). Metadata does not grant
authority, and this work does not block the read-only 0.0.1 release.

## Parallel maintenance

[#45](https://github.com/OpenCoven/sdk/issues/45) and
[#296](https://github.com/OpenCoven/sdk/issues/296) are closed. The two HPKE
integration blockers landed through #299 and #301; the original branch tip
remains preserved at `archive/retired-branch/sdk-20260918/cave-hpke-bound-v1`.
Those development merges do not change the frozen candidate or authorize
publication.

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
