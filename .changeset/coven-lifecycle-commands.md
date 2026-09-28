---
"@opencoven/coven-client": minor
---

Add Phase 2 lifecycle commands: `automations.activate`, `pause`, `disable` and
`tombstone(automationId, expectedRevision, context, options?)`. Each sends one
spec command envelope through a new optional `sendCommand` transport hook,
which the built-in Unix and Windows transports implement for exactly these
four commands. The command is sent only when the producer advertises it.
Results are typed committed, replayed or rejected outcomes. A failure after
the request is sent throws `outcome_unknown`: resend with the same
`adoptionKey` to reconcile. Requires OpenCoven/coven#1176.
