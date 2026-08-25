---
"@opencoven/sdk-core": patch
"@opencoven/cave-client": patch
---

Add explicit managed-native credential custody for narrow native pairing,
credential status, and forget transports. Managed bridges retain pairing
secrets and bearers outside JavaScript while the SDK validates all exposed
non-secret results.

Add browser-safe managed Cave and core subpaths plus a native discovery-source
adapter that validates owner-checked discovery bytes and metadata in the SDK.
