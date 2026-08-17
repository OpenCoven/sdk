# OpenCoven TypeScript SDK

This workspace provides the Phase 0 public SDK scaffold for OpenCoven.

| Path | Package | Purpose |
| --- | --- | --- |
| `packages/core` | `@opencoven/sdk-core` | Transport-neutral errors, compatibility types, and in-memory secrets |
| `packages/cave` | `@opencoven/cave-client` | Constrained caller-supplied Cave transport |
| `packages/coven` | `@opencoven/coven-client` | Constrained caller-supplied Coven transport |
| `packages/sdk` | `@opencoven/sdk` | Optional Cave/Coven coordination |
| `packages/cli` | `@opencoven/dev-cli` | Sole owner of the `opencoven` binary |

The SDK performs no discovery, credential lookup, network, filesystem, or
daemon I/O at import time. Callers provide transports explicitly; Cave and
Coven models, transports, and normalized errors remain distinct.

Reviewed Cave and Coven fixture bytes are committed under their client
packages and verified locally. No authority source tree is imported.

## Validation

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm --recursive build
node scripts/verify-contracts.mjs
node scripts/verify-package.mjs
pnpm lint
```

## License

OpenCoven SDK is dual-licensed under AGPL-3.0-only OR MIT. See
[`LICENSE`](LICENSE).
