# @opencoven/coven-client

A constrained Coven health client. Consumers provide the transport; this
package does not perform daemon discovery or connection at import time, and it
normalizes malformed health responses to a stable SDK error. Valid health
capabilities require boolean `sessions`, `events`, and `structuredErrors`
fields.

```ts
import { COVEN_DAEMON_PROTOCOL, CovenClient } from '@opencoven/coven-client';

const coven = new CovenClient({
  transport: {
    health: async () => ({
      ok: true,
      apiVersion: COVEN_DAEMON_PROTOCOL,
      covenVersion: '0.1.0',
      capabilities: {
        sessions: true,
        events: true,
        eventCursor: 'sequence',
        structuredErrors: true,
      },
    }),
  },
});

await coven.health();
```

`eventCursor` is optional and accepts any string for source compatibility.
Malformed responses and unsupported daemon protocols reject with
`CovenClientError`; transport failures remain available through `error.cause`.
Use `isCovenClientError(error)` when errors may cross bundles or duplicate
package installations.
