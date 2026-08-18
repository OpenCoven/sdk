# OpenCoven TypeScript SDK

This workspace provides the Phase 0 public SDK scaffold for OpenCoven.

## Release status

This source repository is public, but its packages are explicitly marked
private and standard publishing is blocked. It is experimental and not yet a
security-audited release. Standard publishing also requires
`OPENCOVEN_RELEASE_AUTHORIZATION=publish`; remove or change these gates only as
part of an intentional release process.

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
packages and verified locally. Refresh them with
`pnpm sync:contracts -- --cave-root <path> --coven-root <path>` before running
the contract verifier. No authority source tree is imported at runtime.

## Validation

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm --recursive build
node scripts/verify-contracts.mjs
node scripts/verify-package.mjs
node scripts/pack-public-packages.mjs
pnpm lint
```

`pack-public-packages.mjs` is the reusable tarball producer for cross-repository
consumers such as the Chat packed-package canary. It prints JSON containing a
process-created temp `artifactRoot` plus the packed tarball paths for callers
that intentionally keep those artifacts.

## License

OpenCoven SDK is dual-licensed under AGPL-3.0-or-later or MIT. See
[`LICENSE`](LICENSE).
