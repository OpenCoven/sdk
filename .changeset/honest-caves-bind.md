---
"@opencoven/cave-client": patch
---

Add Cave discovery v2 and `hpke-bound-v1` direct and managed consumers. Pairing
secrets and bearers are HPKE-bound for the seven protected Client v1
operations, Auth-mode responses gate credential semantics, and downgrade,
forgery, stale-key, replay-capacity, and native-boundary behavior fail closed.
