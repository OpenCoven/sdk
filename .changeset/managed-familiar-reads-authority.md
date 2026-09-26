---
"@opencoven/cave-client": patch
---

Route managed `familiarContract()` and `familiarAnalytics()` through the same
HPKE authority resolver as the canonical reads. Add optional
`managedHpkeFamiliarContract` and `managedHpkeFamiliarAnalytics` adapter
methods. After the client has observed a discovery-v2 authority, a later v1
authority is refused with `reconcile_required` before the host method runs, and
a v2 authority without the adapter method fails with `unsupported_operation`
instead of falling back to the plain method.
