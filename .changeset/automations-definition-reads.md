---
"@opencoven/coven-client": minor
---

Add capability-gated Automations definition list/get reads using the canonical
authenticated Unix POST /api/v1/actions compatibility surface. Export typed
routine, revision, tombstone, missing-result and read-request types. Reject
crossed action/ID responses, malformed metadata and unadvertised actions;
allowlist read requests before transport I/O. Preserve bounded JSON, connected
peer authentication, deadlines and cancellation. This does not implement rich
definition persistence, receipt authentication, subscriptions, mutation,
execution authority or certification.
