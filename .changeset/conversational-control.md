---
'@opencoven/cave-client': minor
---

Add the first bounded conversational-control authority to `@opencoven/cave-client` with Cave remaining the sole executor and canonical owner: canonical conversation create, idempotent send with one caller-visible operation UUID, explicit retry through a fresh operation UUID and `retryOfTurnId`, non-content operation reads, explicit stop, a typed resumable event stream driven by one translator for initial and resumed pages, operation-ID error propagation, no automatic replay after ambiguous transport completion, and `reconcile_required` helpers that instruct a canonical history reload.

The five Client v1 conversation operations (`conversations.create`, `messages.send`, `operations.read`, `operations.events`, `operations.stop`) are not yet declared by the authoritative Cave contract fixture (pinned producer commit `4adc97b1`), so the optional `CaveTransport` bindings stay unbound and every call reports `unsupported_operation` until the upstream Cave mutation contract lands; no speculative routes ship. The private CLI streaming renderers follow in a separate PR per the design's PR plan.
