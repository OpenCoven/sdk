---
"@opencoven/coven-client": patch
---

Allow supported automation inventories, rich definition snapshots and run logs above 16 KiB through existing typed reads. Keep decoder and authenticated socket limits aligned at explicit finite budgets: 4 MiB for definition/run lists and 1 MiB for individual definition/run reads, while retaining existing narrower capability, control, health, receipt, event and history limits. Schema, duplicate-key, correlation, cancellation and ownership checks remain enforced.
