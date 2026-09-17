---
"@opencoven/cave-client": patch
---

Stop advising retry when a single-use pairing exchange times out. A protected
exchange that reaches an HPKE-bound authority and then times out previously
reported `retryable: true`, even though the pairing secret is dispatched once
and the request may already have been received. The timeout path now applies
the same single-use rule the surrounding transport failure path already used,
so only reusable dispatches remain retryable. Aborted requests and bearer-
protected reads keep their existing retry semantics.
