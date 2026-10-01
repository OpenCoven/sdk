---
"@opencoven/coven-client": minor
---

Add `automations.createDraft(definition, context)` and
`automations.revise(automationId, expectedRevision, definition, context)`.
Both send a rich `coven.automations.v1` definition through the command
envelope. The SDK sets `revision`, the create's `draft` lifecycle state and
the JCS `integrity`, and the built-in transports refuse a body whose digest
does not match. Results use the same committed, replayed or rejected outcomes
as the lifecycle commands. Requires OpenCoven/coven#1185.
