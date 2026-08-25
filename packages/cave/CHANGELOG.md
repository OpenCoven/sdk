# @opencoven/cave-client

## 0.1.0

- Initial experimental SDK foundation. This version is not yet published.
- Harden Cave discovery against record replacement, malformed timestamps and
  nonces, unbounded responses, ambient credentials, cache reuse, redirects,
  and uncancelled response streams while accepting the producer's explicit
  `localhost` loopback form.
- Add a packed runtime-discovery example with deterministic transport and an
  explicit Windows native-trust limitation.
- Align the vendored Cave Client v1 contract and normalized health result with
  the reviewed `OpenCoven/coven-cave` producer fixture.
- Share credential mutation queues across duplicate module copies and use
  atomic compare-and-delete when the configured secret store supports it.
- Accept unavailable (`0`) Windows inode metadata only when reviewed native
  path trust succeeds.
- Bind stored credentials to the Cave health `instanceId`, prove it before
  bearer use, and bracket pairing exchange with pre/post authority proofs.
- Treat failed post-exchange authority proof as a terminal re-pair condition
  because the single-use pairing secret has already been spent.
- Add strict canonical familiar, project, conversation, and message DTOs plus
  five optional one-page `CaveTransport` reads: `listFamiliars()`,
  `listProjects()`, `listConversations()`, `getConversation()`, and
  `listConversationMessages()`.
- Add discovered bearer-authenticated implementations of those reads at the
  exact Client v1 routes, with deterministic `limit`-then-`cursor` query
  ordering and encoded conversation path segments.
- Add bounded `iterateFamiliars()`, `iterateProjects()`,
  `iterateConversations()`, and `iterateConversationMessages()` wrappers; the
  single-item conversation detail route intentionally has no iterator.
- Enforce the Client v1 default page size `50`, maximum `100`, safe-integer
  limits, strict canonical base64url cursors up to 512 characters, required
  success/error metadata, nullable conversation `exitCode`, required-nullable
  message `parentId`, and nonnegative count fields.
- Preserve explicit Cave errors, including producer-supplied retryability for
  `reconcile_required`; callers must reload canonical state rather than
  automatically retrying a mutable page walk.
- Preserve legacy `familiars()`, `familiarContract()`, and
  `familiarAnalytics()` as a separate compatible extension surface.
- Verify the canonical read API and types through package-root imports from
  packed tarballs.
- Add `createManagedCaveClient()` and `CaveManagedNativeTransport` so webview
  consumers can keep pairing secrets and bearer credentials in native custody
  while the SDK remains authoritative for non-secret Client v1 parsing and
  state transitions.
- Stage native credential exchange behind opaque commit handles, validate
  authority binding and credential metadata before commit, and discard exact
  staged values after validation failures, timeout, abort, or late completion.
- Reject secret-bearing, accessor-backed, cyclic, non-finite, oversized, or
  overly complex native payloads, and verify the package-root API through a
  packed fake-native consumer.
- Freeze the packed declaration, runtime exports, and package export map in the
  repository API baseline.
