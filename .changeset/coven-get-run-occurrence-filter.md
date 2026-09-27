---
"@opencoven/coven-client": minor
---

Add `automations.getRun(runId)` over the capability-gated
`coven.automations.run.get.v1` producer action, returning one run with its
attempts, or `{ run: null }`, validated like an occurrence detail's runs. Add an
optional `automationId` to `automations.occurrences()` that the producer applies
inside each view's query; the SDK refuses a filtered page naming any other
automation and rejects an empty or non-string filter before transport I/O.
Both require a producer that advertises them (OpenCoven/coven#1155).
