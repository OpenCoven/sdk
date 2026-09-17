---
"@opencoven/cave-client": patch
---

Stop advising retry when the fetch implementation reports a timeout during a
single-use pairing exchange. Both v1 and HPKE-bound v2 exchanges now report
`retryable: false` while the operation context is still active, because the
authority may already have received the one-time secret. Operation deadline
and abort handling, reusable pairing polls, and bearer-protected reads keep
their existing semantics.
