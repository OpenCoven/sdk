---
"@opencoven/coven-client": patch
---

Add pure local receipt integrity verification and explicit caller-binding checks.
Results remain unverifiable while producer authentication and runtime authority
evidence are unavailable. Digest reference comparisons do not verify artifact
bytes, and existing receipt read semantics are unchanged.
