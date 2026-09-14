# @opencoven/sdk

Optional coordination of separately configured Cave and Coven clients. The
package exports only `createOpenCovenSdk`, `OpenCovenSdk`, and
`OpenCovenSdkError`. It does not discover runtimes, create transports, touch
credential stores, or perform import-time I/O; explicit discovery stays in the
underlying Cave and Coven clients you inject.

For opt-in session-policy admission, depend directly on
`@opencoven/coven-client` and import `createCovenSessionPolicyClient` and
`createCovenSessionPolicyUnixTransport` from that supported release-package
root. See its [policy API documentation](../coven/README.md#session-policy-admission-v1-refusal-only).
The coordinator's health methods neither activate policy requests nor provide
launch fallback; a valid v1 policy response is only a correlated refusal, not
runtime enforcement.

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

## Opt-in Coven Automations

You can reach the configured Automations namespace through the same Coven
client, without extra SDK options or a second discovery:

```ts
import {
  createDiscoveredCovenClient,
  type CovenDiscoveredClientOptions,
} from '@opencoven/coven-client';
import { createOpenCovenSdk } from '@opencoven/sdk';

export async function readAutomations(options: CovenDiscoveredClientOptions) {
  const coven = await createDiscoveredCovenClient({
    ...options,
    automations: true,
  });
  const sdk = createOpenCovenSdk({ coven });
  return sdk.requireCoven().requireAutomations().list();
}
```

Provide your reviewed Unix peer-identity or Windows pipe-ownership and discovery
adapters in `options`. See the [Coven setup and supported matrix](../coven/README.md#opt-into-the-normal-client).
Manual clients opt in with `automationsTransport`. Omission keeps them
health-only: `sdk.coven?.automations` is optional, and `requireAutomations()`
throws a Coven `not_configured` error rather than enabling a transport.

Automations inherits the Coven client's operation defaults and accepts per-call
overrides. `sdk.health()` and `sdk.healthReport()` never invoke it. There is no
direct `sdk.automations` alias, implicit TCP fallback, mutation support, or
independent receipt authentication.

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
