---
"@opencoven/coven-client": minor
"@opencoven/sdk": minor
---

Add authenticated Windows named-pipe Automations reads with the same bounded
wire contract, strict decoders, and per-connection owner-local checks as Unix.
Expose an optional Automations namespace on CovenClient via an explicit
automationsTransport or discovered-client automations opt-in, sharing operation
defaults and remaining reachable through sdk.coven and requireCoven().
Health-only and standalone clients remain compatible. No TCP fallback,
mutations, independent receipt authentication, or authority acceptance is added.
