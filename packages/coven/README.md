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
    health: async (context) => ({
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

await coven.health({ timeoutMs: 5_000 });
```

`eventCursor` is optional and accepts any string for source compatibility.
Malformed responses and unsupported daemon protocols reject with
`CovenClientError`; transport failures remain available through `error.cause`.
Use `isCovenClientError(error)` when errors may cross bundles or duplicate
package installations.

`health()` accepts an optional signal, timeout, and lifecycle observer.
Constructor operation defaults remain additive, and zero-argument transports
remain compatible. There is no default timeout. Timeout rejects promptly for
non-cooperative transports, while stopping underlying daemon I/O requires the
transport to honor its context signal. Causes may contain transport data and
must not be logged blindly.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
