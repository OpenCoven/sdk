---
"@opencoven/cave-client": minor
"@opencoven/sdk": minor
---

Add Cave discovery v2 and `hpke-bound-v1` direct and managed consumers. Pairing
secrets and bearers are HPKE-bound for the seven protected Client v1
operations, Auth-mode responses gate credential semantics, and downgrade,
forgery, stale-key, replay-capacity, and native-boundary behavior fail closed.

This widens discovered endpoint version narrowing from `1` to `1 | 2`.
Consumers with exhaustive discovery-version handling must add the version 2
authority branch before upgrading.
