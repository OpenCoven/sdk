---
"@opencoven/coven-client": minor
---

Add `automations.occurrenceHistory(automationId, { limit, cursor })` over the
capability-gated `coven.automations.occurrence.history.v1` producer action: one
automation's occurrences in every state, newest first, as an sdk-core `Page`
with an opaque keyset cursor. Add `iterateOccurrenceHistory()` on sdk-core
`iteratePages`. The SDK validates the cursor before transport I/O, refuses pages
that cross automations, break ordering or do not echo the requested cursor, and
caps history responses at 256 KiB. Requires OpenCoven/coven#1157.
