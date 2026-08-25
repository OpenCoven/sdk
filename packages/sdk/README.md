# @opencoven/sdk

Optional coordination of separately configured Cave and Coven clients. The
package exports only `createOpenCovenSdk`, `OpenCovenSdk`, and
`OpenCovenSdkError`. It does not discover runtimes, create transports, touch
credential stores, or perform import-time I/O; explicit discovery stays in the
underlying Cave and Coven clients you inject.

The supported root API, pre-1.0 compatibility rules, and deprecation process
are documented in the repository
[compatibility policy](https://github.com/OpenCoven/sdk/blob/main/COMPATIBILITY.md)
and [support policy](https://github.com/OpenCoven/sdk/blob/main/SUPPORT.md).

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

## Shipped surface

- `availability()` reports which clients are configured.
- `requireCave()` and `requireCoven()` return the configured client or throw
  `OpenCovenSdkError`.
- `health()` preserves the original fail-fast behavior and returns only
  configured healthy values.
- `healthReport()` starts configured checks concurrently and returns a
  discriminated result for each client:

- `not_configured`
- `healthy` with the health value
- `unhealthy` with the typed client error

## Deadlines, compatibility, and retry guidance

The top-level timeout is one total budget. Sequential `health()` subtracts time
already spent in Cave before starting Coven. Concurrent `healthReport()` starts
both checks immediately and preserves a healthy peer when the other times out.
Per-client signals and timeouts may be stricter but cannot extend the global
deadline. A top-level observer is forwarded to both clients without emitting
duplicate SDK-layer terminal events.

There is no default timeout and no automatic retry. Timeout can return while a
non-cooperative transport continues its own work; transports must honor their
context signal to stop underlying I/O. Compatibility and typed errors come from
the underlying clients: Cave keeps the reviewed additive Client v1 rules,
while Coven keeps the exact daemon v1 transport-security requirements already
configured on that client. If coordinated Coven health reports
`platform_security_unavailable`, fix the embedding runtime by injecting a
reviewed native transport-security adapter instead of accepting pathname-only
or shell-derived proof.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
