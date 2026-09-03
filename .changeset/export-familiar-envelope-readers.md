---
"@opencoven/cave-client": minor
---

Export `canonicalFamiliarContractData` and `canonicalFamiliarAnalyticsData`
from the package root and the `/managed` subpath. A host that owns its own
transport -- a native bridge that returns what Cave sent -- needs to turn a
canonical envelope into the response `familiarContract()` and
`familiarAnalytics()` consume, and the declaration check belongs in the SDK
rather than being reimplemented against the same wire by every host.
