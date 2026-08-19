# @opencoven/sdk

Optional coordination of separately configured Cave and Coven clients.

```ts
import { createOpenCovenSdk } from '@opencoven/sdk';

const sdk = createOpenCovenSdk({ cave, coven });
const report = await sdk.healthReport();

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
