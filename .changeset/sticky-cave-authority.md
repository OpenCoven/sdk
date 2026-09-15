---
"@opencoven/cave-client": patch
---

Keep discovery v2 authority requirements for the lifetime of each discovered
client. Reject later protected v1 requests before credential access or secret
dispatch, preserve current stored credentials across concurrent downgrade
checks, and snapshot discovered endpoints before pinning pairing authority.
Public health and pairing creation remain available, and independent clients
that have only observed v1 retain legacy behavior.
