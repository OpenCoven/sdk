# @opencoven/sdk

Optional coordination of separately configured Cave and Coven clients.

```ts
import { createOpenCovenSdk } from '@opencoven/sdk';

const sdk = createOpenCovenSdk({ cave, coven });
const report = await sdk.healthReport({
  timeoutMs: 5_000,
  cave: { timeoutMs: 2_000 },
});

if (report.cave.status === 'unhealthy') {
  console.error(report.cave.error.normalized);
}
```

`health()` preserves the original fail-fast behavior and returns only configured
healthy values. `healthReport()` starts configured checks concurrently and
returns a discriminated result for each client:

- `not_configured`
- `healthy` with the health value
- `unhealthy` with the typed client error

`availability()` reports configured clients. `requireCave()` and
`requireCoven()` return their client or throw `OpenCovenSdkError`.

The top-level timeout is one total budget. Sequential `health()` subtracts time
already spent in Cave before starting Coven. Concurrent `healthReport()` starts
both checks immediately and preserves a healthy peer when the other times out.
Per-client signals and timeouts may be stricter but cannot extend the global
deadline. A top-level observer is forwarded to both clients without emitting
duplicate SDK-layer terminal events.

There is no default timeout and no automatic retry. Timeout can return while a
non-cooperative transport continues its own work; transports must honor their
context signal to stop underlying I/O.

## Diagnostics

```ts
const bundle = await sdk.diagnostics({
  runtime: { node: process.version, platform: process.platform },
  discovery: [{ label: 'cave', url: caveUrl }],
});
```

Runs the same concurrent health check as `healthReport()` and reduces it to a
sanitized support bundle: package versions, per-client capabilities, endpoint
shapes, operation counts, and normalized error codes. It **excludes prompts,
tokens, attachments, and event payloads** — see `@opencoven/sdk-core` for the
allowlist and what it does to an endpoint and an error message.

Capabilities are read from the configured clients, not from the network.
`capabilities()` on either client answers which operations its transport
actually implements, so an unconfigured client contributes no group at all —
a different claim from a group of falses.

A caller-supplied `observer` still receives every event; the bundle records
them alongside it, before the delegate sees them, so an observer that throws
still contributes its event.

## Browser applications

A browser cannot connect to Cave or Coven directly in v1. Both clients take a
caller-supplied transport and never discover an endpoint or a credential, so a
browser would have to hold the credential itself and reach an origin the daemons
do not serve. Run this package in a server-side runtime you control and let the
browser talk to that.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
