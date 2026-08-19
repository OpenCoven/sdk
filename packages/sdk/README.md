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

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
