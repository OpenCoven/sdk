---
"@opencoven/cave-client": patch
---

Read the familiar roster in Cave's contract spelling. The discovered and
managed transports parsed `GET /api/client/v1/familiars` with the earlier
snake_case field names, while a real Cave serves the documented camelCase
roster (`displayName`, `lastSeenAt`, `activeSessions`), so `credentialStatus()`
and `familiars()` refused every non-empty roster with
`invalid_response` ("display_name must be a non-empty string"). The contract
spelling is read first; the snake_case spelling is still accepted for an older
Cave. `listFamiliars()` and the other canonical reads were already correct and
are unchanged.
