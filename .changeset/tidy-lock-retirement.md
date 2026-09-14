---
"@opencoven/dev-cli": patch
---

Retire owned credential-lock directories before removing them, preventing Windows
contenders from recreating a name while its previous directory is pending deletion.
Permission failures remain fail-closed without retries.
