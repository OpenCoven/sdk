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

Align protected route AAD with the canonical encoded-segment behavior merged
in OpenCoven/coven-cave#5071 at
`1d16736e637de384ebf7423c05862d66860478c4`. IDs containing `/`, `?`, `#`,
spaces, Unicode, or literal `%` retain their exact `encodeURIComponent` bytes;
noncanonical path spellings remain rejected and query behavior is unchanged.
