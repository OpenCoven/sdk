---
"@opencoven/cave-client": patch
---

Add explicit managed-native credential custody for narrow native pairing,
credential status, and forget transports. Managed bridges retain pairing
secrets and bearers outside JavaScript while the SDK validates all exposed
non-secret results.
