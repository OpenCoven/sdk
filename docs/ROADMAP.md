# OpenCoven SDK Roadmap

The OpenCoven SDK is experimental and unpublished. The current objective is a secure read-only 0.1 release that proves discovery, consent, identity, credential custody, canonical reads, native trust, and packed-consumer behavior before adding mutation authority.

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
- strict Cave Client v1 one-page canonical reads and bounded lazy iterators on
  the SDK #36 feature branch;
- contract fixture verification;
- property, stress, package, and packed-consumer tests;
- a locked two-key release system with checksummed artifacts and OIDC-oriented publishing.

The packages remain private and public publishing remains intentionally disabled.

SDK [#36](https://github.com/OpenCoven/sdk/issues/36) is implementation-complete
and fully verified/reviewed on `feat/cave-canonical-reads`, pending PR,
required checks, and merge. The branch exposes five one-page reads
(`listFamiliars`, `listProjects`, `listConversations`, `getConversation`, and
`listConversationMessages`) plus four bounded list iterators; it has no detail
iterator. Limits default to `50`, reject unsafe or out-of-range values above
the maximum `100`, and use opaque strict canonical base64url cursors bounded to
512 characters. Iterators require positive `maxPages` or a caller-owned signal
and never prefetch, retry, or implicitly walk the whole corpus.

Chat [#27](https://github.com/OpenCoven/chat/issues/27) remains blocked on
merged SDK #36, SDK #37 native-adapter ownership, and producer
[`OpenCoven/coven-cave#4996`](https://github.com/OpenCoven/coven-cave/issues/4996)
for atomic binding of pairing-secret and bearer-bearing requests where
applicable. The SDK's unauthenticated instance proof followed by an
authenticated canonical request remains defense in depth, not atomic binding.

## Now — secure read-only 0.1

### Contract truth

- [#32](https://github.com/OpenCoven/sdk/issues/32) — reconcile release scope and current plans
- [Cave #4869](https://github.com/OpenCoven/coven-cave/issues/4869) — make capabilities operationally truthful
- [#33](https://github.com/OpenCoven/sdk/issues/33) — source-lock the Cave contract and correct health compatibility

### Protocol

- [#34](https://github.com/OpenCoven/sdk/issues/34) — secure Cave discovery
- [#35](https://github.com/OpenCoven/sdk/issues/35) — pairing and credential custody
- [#36](https://github.com/OpenCoven/sdk/issues/36) — implementation, full verification, and review complete on branch; PR, checks, and merge pending
- [#37](https://github.com/OpenCoven/sdk/issues/37) — CLI scope and native trust boundaries

### Consumer and evidence

- [Chat #27](https://github.com/OpenCoven/chat/issues/27) — packed SDK/native integration
- [#38](https://github.com/OpenCoven/sdk/issues/38) — cross-repository real-authority conformance
- [#39](https://github.com/OpenCoven/sdk/issues/39) — profiles, diagnostics, and public API governance

### Release

- [#40](https://github.com/OpenCoven/sdk/issues/40) — security review and ship/block disposition
- [#41](https://github.com/OpenCoven/sdk/issues/41) — release execution and registry/provenance validation

## Next — conversational control

[#42](https://github.com/OpenCoven/sdk/issues/42) adds the first bounded mutation tier:

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

## Parallel maintenance

[#45](https://github.com/OpenCoven/sdk/issues/45) audits legacy branches, worktrees, and stash state. Cleanup is separately authorized and does not block 0.1 unless unique work or release/provenance risk is discovered.

## 0.1 release bar

The first release does not ship until all of the following are true:

- the SDK fixture matches a named Cave producer commit;
- compatibility health and capability declarations are truthful;
- discovery, pairing, credential custody, and canonical reads work from packed artifacts;
- Coven IPC trust uses live connected-peer or pipe identity;
- Chat completes the journey through native custody and trust adapters;
- SDK and Chat are removed from conformance `notCovered`;
- supported operating systems have real evidence;
- public API baselines and redacted diagnostics are complete;
- the security review recommends ship;
- registry bytes and provenance match the reviewed release manifest;
- bootstrap credentials are revoked;
- ordinary future publishing uses protected OIDC with no token fallback.
