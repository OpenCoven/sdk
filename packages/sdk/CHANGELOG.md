# @opencoven/sdk

## 0.0.1

- Initial experimental SDK foundation. This version is not yet published.
- Freeze the packed declaration, runtime exports, and package export map in the
  repository API baseline.
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
