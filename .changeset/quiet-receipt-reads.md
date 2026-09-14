---
"@opencoven/coven-client": minor
---

Add capability-gated `getReceipt(id, operationOptions?)` over authenticated
owner-local Unix IPC using the exact `coven.automations.receipt.get.v1` result
contract. Export receipt/read-diagnostic types, validate bounded nested shapes
and ID correlation, and preserve sanitized typed producer rejections.
Producer verification diagnostics remain unverifiable; this does not add
independent receipt authentication or authority acceptance.
