---
"@opencoven/cave-client": patch
---

Add optional managed HPKE read adapters with strict authentication receipts and
independent iterator authority continuity. Refuse authority changes before
forwarding cursors, preserve cancellation, and perform no automatic page retry.
Pairing and single-use credential behavior remain unchanged.
