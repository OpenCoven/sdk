# @opencoven/cave-client

## 0.0.1

- Initial experimental SDK foundation. This version is not yet published.
- Adopt the reviewed Cave Client v1 minimum of `0.0.1` from authority commit
  `e806655a7100e9d589662a6f3817c3fd8cde48ad`, preserving strict compatibility
  comparisons and the original HPKE cryptographic vectors.
- Preserve the authority's `ownership_refused` error through pairing,
  canonical reads, and redacted managed clients without automatic retries.
- Add a native discovery-source adapter that validates owner-checked discovery
  bytes and metadata in the SDK, with narrow managed-native pairing, credential
  status, and forget transports that keep secrets outside JavaScript.
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
- Treat unavailable (`0`) or out-of-range Windows device/inode metadata as
  native-identity-only, require reviewed path and opened-handle trust, and
  derive stable portable credential-binding identifiers from that native
  identity.
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
- Keep the managed browser entry free of Node built-ins while validating and
  exposing strict HPKE discovery v2 authority metadata with browser Web Crypto.
- Freeze the packed declaration, runtime exports, and package export map in the
  repository API baseline.
- Preserve client-v1 familiar contract presence, identity and ward fields and
  daily analytics. Add validated managed-envelope adapters and bounded analytics
  window options. Retain the legacy boolean presence form as an explicit union
  for existing transports.
- Keep discovery v2 authority requirements for the lifetime of each discovered
  client. Reject later protected v1 requests before credential access or secret
  dispatch, preserve current stored credentials across concurrent downgrade
  checks, and snapshot discovered endpoints before pinning pairing authority.
  Public health and pairing creation remain available, and independent clients
  that have only observed v1 retain legacy behavior.
- Omit the untrusted fetch exception from the public error cause chain once an
  HPKE-protected request has been constructed, and replace fetch-supplied
  timeout and abort errors with fixed, cause-free errors that keep their codes
  and retryability.
- Stop advising retry when the fetch implementation reports a timeout during a
  single-use pairing exchange. Both v1 and HPKE-bound v2 exchanges now report
  `retryable: false` while the operation context is still active, because the
  authority may already have received the one-time secret. Operation deadline
  and abort handling, reusable pairing polls, and bearer-protected reads keep
  their existing semantics.
- Add optional managed HPKE read adapters with strict authentication receipts
  and independent iterator authority continuity. Refuse authority changes before
  forwarding cursors, preserve cancellation, and perform no automatic page
  retry. Pairing and single-use credential behavior remain unchanged.
- Update the pinned `canonicalize` dependency from 4.0.0 to 5.1.0.
