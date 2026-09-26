# @opencoven/coven-client

## 0.0.1

- Initial experimental SDK foundation. This version is not yet published.
- Add opt-in Automations v1 capability discovery and its authenticated Unix
  GET transport through the public package root.
- Validate bounded raw capability catalogs, preserve supported, experimental,
  and refused variants, and report missing, planned, or unnegotiated
  advertisements as unavailable.
- Preserve connected-peer security, cancellation, deadlines, and the existing
  health-only client behavior. Capability discovery does not provide receipt
  authentication, execution authority, mutations, or certification.
- Freeze the packed declaration, runtime exports, and package export map in the
  repository API baseline.
- Add capability-gated Automations definition list/get reads using the canonical
  authenticated Unix POST /api/v1/actions compatibility surface. Export typed
  routine, revision, tombstone, missing-result and read-request types. Reject
  crossed action/ID responses, malformed metadata and unadvertised actions;
  allowlist read requests before transport I/O. Preserve bounded JSON, connected
  peer authentication, deadlines and cancellation. This does not implement rich
  definition persistence, receipt authentication, subscriptions, mutation,
  execution authority or certification.
- Add capability-gated automation health reads using the canonical health
  action, authenticated bounded transport, correlated IDs, and validated
  nullable diagnostics.
- Add capability-gated Automations run history via the exact producer
  `coven.automations.runs` action, with bounded limits, typed compatibility run,
  attempt and cancellation projections, correlated response validation, and the
  existing authenticated Unix read transport and shared cancellation/deadline.
  Receipt references remain diagnostic data, not authenticated authority.
- Add exact-capability-gated global occurrence inspection by scheduler view and
  occurrence detail reads over authenticated Unix IPC. Validate bounded typed
  occurrences and correlated nested runs/attempts, preserve explicit truncation,
  and share the operation deadline and cancellation scope. These are producer
  diagnostics, not paginated per-automation history or authenticated authority.
- Add capability-gated `getReceipt(id, operationOptions?)` over authenticated
  owner-local Unix IPC using the exact `coven.automations.receipt.get.v1` result
  contract. Export receipt/read-diagnostic types, validate bounded nested shapes
  and ID correlation, and preserve sanitized typed producer rejections. Producer
  verification diagnostics remain unverifiable; this does not add independent
  receipt authentication or authority acceptance.
- Add authenticated Windows named-pipe Automations reads with the same bounded
  wire contract, strict decoders, and per-connection owner-local checks as Unix.
  Expose an optional Automations namespace on CovenClient via an explicit
  automationsTransport or discovered-client automations opt-in, sharing
  operation defaults and remaining reachable through sdk.coven and
  requireCoven(). Health-only and standalone clients remain compatible. No TCP
  fallback, mutations, independent receipt authentication, or authority
  acceptance is added.
- Add opt-in Automations domain event pages and demand-driven subscription
  iteration through the authenticated Unix and Windows transports. Validate
  stream binding, exclusive cursors, typed checkpoint expiry, and bounded
  responses without background polling or automatic cursor resets.
- Add pure local receipt integrity verification and explicit caller-binding
  checks. Results remain unverifiable while producer authentication and runtime
  authority evidence are unavailable. Digest reference comparisons do not verify
  artifact bytes, and existing receipt read semantics are unchanged.
- Add bounded local helpers for complete Automations definition digests,
  optional event-integrity checks, and non-authoritative event projection.
  Preserve receipt behavior and keep unavailable authentication, runtime
  authority, and full transition validation explicit.
