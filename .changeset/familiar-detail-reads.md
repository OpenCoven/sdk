---
"@opencoven/cave-client": minor
"@opencoven/sdk-core": minor
---

Serve the two familiar detail reads Cave promoted into Client v1 —
`familiars.contract.read` (`GET /api/client/v1/familiars/:id/contract`) and
`familiars.analytics.read` (`GET /api/client/v1/familiars/:id/analytics`) —
from both the discovered transport and the managed-native bridge, so
`familiarContract()` and `familiarAnalytics()` no longer depend on a custom
transport. Both reads require the `chat:read` scope and carry the same
request binding as the other canonical reads, advertised under the new
`familiar-contract` and `familiar-analytics` capability families.

`CaveFamiliarContract.present` is now the per-file record Cave actually serves
(`{ soul, identity, ward, memory }`) rather than a single boolean; a transport
still answering the boolean is refused as `invalid_response`. The contract
gains optional `identity` (`name`, `creature`, `person`) and `ward`
(protected files, invariants, editable paths, `approvalTiers.auto` and
`.humanReview`) records. Execution windows `7d` and `14d` carry a `days`
runs-per-day series, and `familiarAnalytics()` accepts a `window` option.

The vendored Cave contract fixture is refreshed to `OpenCoven/coven-cave`
`53cd5bf0986a6df92f66dc6622441c74e31af5db`, which also adds the
`ownership_refused` error code to `CAVE_CONTRACT_ERROR_CODES`.
