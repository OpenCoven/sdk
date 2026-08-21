# OpenCoven TypeScript SDK

> [!WARNING]
> **Experimental — not ready for public consumption.** This SDK is under active
> development, has not been security audited, and may change without notice. Do
> not use it for production workloads or with production credentials.

This workspace provides the Phase 0 public SDK scaffold for OpenCoven.

## Release status

This source repository is public, but its packages are explicitly marked
private, are not published, and have standard publishing blocked. It is
experimental and not yet a security-audited release. Standard publishing also requires
`OPENCOVEN_RELEASE_AUTHORIZATION=publish`; remove or change these gates only as
part of an intentional release process.

- [Support policy](SUPPORT.md)
- [Security policy](SECURITY.md)
- [Release process](RELEASING.md)

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

## Choosing a package

| Need | Package |
| --- | --- |
| Shared errors, compatibility, or in-memory secrets | `@opencoven/sdk-core` |
| Cave health and reviewed Cave contract fixtures | `@opencoven/cave-client` |
| Coven daemon health | `@opencoven/coven-client` |
| Optional Cave/Coven coordination | `@opencoven/sdk` |
| Deterministic developer CLI output | `@opencoven/dev-cli` |

## Caller-supplied transports

Clients never discover an endpoint or credential. Supply the narrow transport
needed by the operation:

```ts
import { CaveClient, isCaveClientError } from '@opencoven/cave-client';

const cave = new CaveClient({
  transport: {
    health: async () => {
      const response = await fetch('https://example.invalid/health');
      return response.json();
    },
  },
});
```

The SDK does not own the URL, authentication, retry, or fetch policy. Callers
may provide cancellation and an optional SDK-enforced timeout:

```ts
const controller = new AbortController();

await cave.health({
  signal: controller.signal,
  timeoutMs: 5_000,
  observer: {
    onEvent(event) {
      telemetry.record(event);
    },
    onObserverError(error, event) {
      telemetry.recordObserverFailure(error, event);
    },
  },
});
```

There is no default timeout. A configured timeout rejects promptly even when a
transport ignores the supplied signal; only a cooperative transport can stop
its underlying I/O. Transports receive an optional context with the composed
`signal` and absolute monotonic `deadline`.

## Coordinated health

| API | Behavior |
| --- | --- |
| `health()` | Checks configured clients in order and rejects on the first failure |
| `healthReport()` | Starts configured checks concurrently and reports each as `healthy`, `unhealthy`, or `not_configured` |

Top-level SDK timeouts are total budgets across all configured clients.
Per-client timeouts and signals can make one check stricter, but cannot extend
the global deadline. Lifecycle events remain Cave- or Coven-specific and
contain only allowlisted normalized metadata.

Client errors expose stable normalized metadata and retain the original failure
as `cause`:

```ts
try {
  await cave.health();
} catch (error) {
  if (isCaveClientError(error)) {
    console.error(error.normalized.code, error.normalized.requestId);
    console.error(error.cause);
  }
}
```

Do not serialize or log `cause` blindly: it may contain caller or transport
data. Observer events exclude causes, stacks, transport messages, and response
payloads.

## Diagnostics

`sdk.diagnostics()` runs the same concurrent health check as `healthReport()`
and reduces it to a support bundle: package versions, per-client capabilities,
endpoint shapes, operation counts, and normalized error codes. `opencoven
diagnostics` prints the same shape for the installed CLI, which contacts
nothing.

Bundles are assembled from an allowlist and **exclude prompts, tokens,
attachments, and event payloads**. An error contributes its normalized `code`
rather than its message, and an endpoint is reduced to its shape: a loopback
host survives, every other host is reported as `redacted`, and a credential in
the URL is reported as a boolean rather than repeated. Two consequences worth
knowing: a bundle is safe to paste into an issue, and it will not tell you which
host you were pointed at.

Two fields are passed through rather than authored here: an error's `code` and
its `requestId`, both copied off whatever your transport threw and checked only
for shape. A code is what every count in the bundle is grouped by and a request
id is what a support thread is opened to quote, so filtering either to codes
this SDK already knows would discard the transport's own diagnosis. A transport
that puts a credential in either field puts it in the bundle.

Capabilities come from the configured transports, never from the network, so an
unconfigured client contributes no group at all — a different claim from a group
of falses.

## Developer CLI

```bash
opencoven diagnostics --json
opencoven completions bash            # also zsh, fish, powershell
opencoven scaffold unified-status ./my-status
```

Completion scripts are generated from the same command and template lists the
CLI dispatches on, so they cannot offer a command the binary rejects.

Scaffolds are supported TypeScript starting points — `cave-chat`,
`coven-observer`, and `unified-status`. A scaffold **refuses to overwrite an
existing file** unless `--force` is given, and its dependencies are the packed
SDK tarballs, because these packages are not published. `pnpm verify:package`
generates every scaffold, installs the freshly packed tarballs into it offline,
compiles it, and runs it.

## Browser applications

A browser cannot connect to Cave or Coven directly in v1. Both clients take a
caller-supplied transport and never discover an endpoint or a credential, so a
browser would have to hold the credential itself and reach an origin the daemons
do not serve. Run the SDK in a server-side runtime you control and let the
browser talk to that.

## Runtime control errors

| Code | Meaning | Retryable |
| --- | --- | --- |
| `timeout` | The configured operation deadline elapsed | Yes |
| `aborted` | A caller-owned signal cancelled the operation | No |
| `invalid_options` | A timeout or signal option was invalid | No |

Timeouts must be positive safe integers no greater than `2_147_483_647`.
Automatic retries are intentionally not performed.

## Production checklist

- Configure an explicit timeout for every remote operation.
- Define which application component owns each cancellation signal.
- Implement both observer callbacks and route observer failures to a safe sink.
- Supply application-managed persistent credential storage; SDK memory stores
  are non-persistent.
- Treat error causes as sensitive and log only normalized or event metadata.
- Complete the separate release-readiness gate before publishing or production
  adoption; these packages remain private and experimental.

Reviewed Cave and Coven fixture bytes are committed under their client
packages and verified locally. Refresh them with
`pnpm sync:contracts -- --cave-root <path> --coven-root <path>` before running
the contract verifier. No authority source tree is imported at runtime.

## Validation

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
node scripts/verify-contracts.mjs
node scripts/verify-package.mjs
node scripts/verify-release-readiness.mjs
pnpm test:coverage
pnpm test:stress
pnpm lint
```

`corepack pnpm@10.34.0 verify` runs that canonical sequence after installation.

`pack-public-packages.mjs` is the reusable tarball producer for cross-repository
consumers such as the Chat packed-package canary. It prints JSON containing a
process-created temp `artifactRoot` plus the packed tarball paths for callers
that intentionally keep those artifacts.

Runnable deterministic examples are documented in [`examples/README.md`](examples/README.md).

## Local security checks

Install the repository hooks once per checkout:

```bash
pre-commit install
```

The hook scans staged changes for likely credentials and private keys. To scan
the current branch's full Git history before sharing or publishing work, install
Gitleaks and run:

```bash
gitleaks git .
```

## License

OpenCoven SDK is dual-licensed under AGPL-3.0-only OR MIT. See
[`LICENSE`](LICENSE).
