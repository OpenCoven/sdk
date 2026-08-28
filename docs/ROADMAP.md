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
- strict Cave Client v1 one-page canonical reads and bounded lazy iterators
  merged through SDK PR #55;
- contract fixture verification;
- property, stress, package, and packed-consumer tests;
- a locked two-key release system with checksummed artifacts and OIDC-oriented publishing.

All workspace packages remain private and public publishing remains
intentionally disabled. The 0.1 release inventory contains the four SDK
libraries; `@opencoven/dev-cli` remains a source-tested private workspace and
is excluded from release artifacts and the Changesets fixed group.

SDK [#35](https://github.com/OpenCoven/sdk/issues/35) merged through PR #69 at
`163961f4e59cfdef51d2271fa98e7c514977203f`. It adds strict discovery v2 plus
`hpke-bound-v1`, and the upstream producer/runtime authority boundary landed in
[`OpenCoven/coven-cave#5044`](https://github.com/OpenCoven/coven-cave/pull/5044)
at merge commit `2a0ff9237e94e652e477b22f60fd6d721b9e6451`, closing
[`OpenCoven/coven-cave#4996`](https://github.com/OpenCoven/coven-cave/issues/4996).
Issue #35 remains open only for real-authority pairing/custody evidence
covering secure-store failure/retry, restart reuse, revocation,
ambiguity handling, and no-secret retention.

SDK [#36](https://github.com/OpenCoven/sdk/issues/36) merged through PR #55 at
`d7f9e69378d6136c2771f60b4c57d7beeaa74f6a`. It exposes five one-page reads
(`listFamiliars`, `listProjects`, `listConversations`, `getConversation`, and
`listConversationMessages`) plus four bounded list iterators; it has no detail
iterator. Limits default to `50`, reject unsafe or out-of-range values above
the maximum `100`, and use opaque strict canonical base64url cursors bounded to
512 characters. Iterators require positive `maxPages` or a caller-owned signal
and never prefetch, retry, or implicitly walk the whole corpus.

SDK [#37](https://github.com/OpenCoven/sdk/issues/37) records that the private
CLI is deferred from 0.1 and that Chat's Tauri layer owns the Phase 1 native
trust adapters. The 0.1 native Chat/real-authority conformance matrix is now
frozen to `darwin-arm64`, `linux-x64`, and `win32-x64`. Chat
[#27](https://github.com/OpenCoven/chat/issues/27) remains blocked on durable
implementation of those adapters and complete cross-repository evidence across
that matrix. Its comments cite
commit `950feb5` and branch `feat/native-sdk-integration`, but neither is
currently reachable on GitHub, so recovery or rebuild of that integration
evidence may be required before [#38](https://github.com/OpenCoven/sdk/issues/38)
can close.

## Now — secure read-only 0.1

### Contract truth

- [#32](https://github.com/OpenCoven/sdk/issues/32) — reconcile release scope and current plans
- [Cave #4869](https://github.com/OpenCoven/coven-cave/issues/4869) — make capabilities operationally truthful
- [#33](https://github.com/OpenCoven/sdk/issues/33) — source-lock the Cave contract and correct health compatibility

### Protocol

- [#34](https://github.com/OpenCoven/sdk/issues/34) — secure Cave discovery
- [#35](https://github.com/OpenCoven/sdk/issues/35) — pairing and credential
  custody; strict discovery v2 + `hpke-bound-v1` merged through PR #69, but
  real-authority pairing/custody evidence remains open
- [#36](https://github.com/OpenCoven/sdk/issues/36) — canonical reads merged through PR #55
- [#37](https://github.com/OpenCoven/sdk/issues/37) — defer private CLI from 0.1; assign Phase 1 native trust adapters to Chat

### Consumer and evidence

- [Chat #27](https://github.com/OpenCoven/chat/issues/27) — packed SDK/native
  integration; durable implementation and reachable GitHub evidence still
  required
- [#38](https://github.com/OpenCoven/sdk/issues/38) — cross-repository
  real-authority conformance blocked on Chat #27 and complete
  cross-repository evidence across the frozen `darwin-arm64`, `linux-x64`, and
  `win32-x64` matrix; one passing record is required for each target
- [#39](https://github.com/OpenCoven/sdk/issues/39) — profiles, diagnostics, and public API governance

### Release

- [#40](https://github.com/OpenCoven/sdk/issues/40) — security review and
  ship/block disposition; remains BLOCK until the exact final candidate is
  re-reviewed
- [#41](https://github.com/OpenCoven/sdk/issues/41) — release execution and
  registry/provenance validation; locked, packages private, publishing disabled

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
The [implementation design](superpowers/specs/2026-08-28-sdk-offline-reads-and-tooling-design.md)
requires real producer revisions and keeps the CLI private unless a separate
distribution gate is approved.

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
- the frozen native conformance matrix has one passing record each for
  `darwin-arm64`, `linux-x64`, and `win32-x64`;
- public API baselines and redacted diagnostics are complete;
- the security review recommends ship;
- registry bytes and provenance match the reviewed release manifest;
- bootstrap credentials are revoked;
- ordinary future publishing uses protected OIDC with no token fallback.
