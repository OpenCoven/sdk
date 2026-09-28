---
"@opencoven/coven-client": minor
---

Add `automations.runHistory(automationId, { limit, cursor, occurrenceId })`
over the capability-gated `coven.automations.run.history.v1` producer action:
one automation's runs, newest first by start instant, as an sdk-core `Page`
with a keyset cursor of at most 256 characters. Also add `iterateRunHistory()`
on `iteratePages`. Pages that cross automations or occurrences, break
ordering, or do not echo the cursor are refused, and responses share the
256 KiB history cap. Requires OpenCoven/coven#1160.
