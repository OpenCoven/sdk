---
"@opencoven/cave-client": patch
---

Send Cave request bodies as bytes instead of strings. A string body made
`fetch` add `content-type: text/plain;charset=UTF-8`, and Cave's proxy refuses
that media type with 415 before any route runs, so the bodyless pairing
exchange (`POST /api/client/v1/pairing/requests/:id/exchange`) failed with
`invalid_request` against a real Cave and no credential was ever issued. The
pairing create keeps its explicit `application/json` header; no other header
changes.
