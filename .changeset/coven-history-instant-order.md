---
"@opencoven/coven-client": patch
---

Check occurrence-history order by instant rather than text, matching the
producer (OpenCoven/coven#1158). Scheduled occurrences store millisecond and
manual ones nanosecond timestamps, so pages that mix them were refused as
out of order.
