# @opencoven/dev-cli

The sole owner of the `opencoven` binary in this workspace.

Importing `@opencoven/dev-cli` performs no runtime discovery, daemon I/O, or
keyring I/O. Work begins only when you call `runCli()`, `main()`, or
`createNativeSecretStore()`.

```bash
opencoven --help
opencoven doctor
opencoven discover --json
opencoven cave pair
opencoven cave status
opencoven cave forget
opencoven coven health
```

## Public package surface

- `runCli(argv, runtime?)` returns `{ exitCode, stdout, stderr }` without
  touching process stdio.
- `main(argv)` writes the formatted result to process stdout/stderr and returns
  the exit code.
- `formatCliOutput(output, 'human' | 'json')` renders the stable secret-free
  envelopes.
- `createNativeSecretStore()` and `SecureStoreUnavailableError` expose the
  reviewed keyring wrapper used by Cave commands.
- `DEV_CLI_VERSION` and `CLI_USAGE` publish the shipped CLI identity and
  command set.

## Command contract

- `opencoven doctor [--json]` runs Cave discovery/health, a native secure-store
  probe, and Coven discovery/health inside one shared deadline; exit code `1`
  means at least one check failed or the shared budget forced later checks to
  skip.
- `opencoven discover [--json]` runs Cave and Coven discovery concurrently and
  exits `1` if either probe fails.
- `opencoven cave pair [--json]` creates, polls, and exchanges one Cave
  pairing request inside one absolute workflow deadline and stores the bearer
  together with authority metadata in one versioned native-keyring record.
- `opencoven cave status [--json]` validates the stored Cave credential against
  the current authority binding and returns `valid`, `missing`, `disconnected`,
  or `revoked`. Reads see either the previous committed credential, the new
  committed credential, or no credential at all; malformed records fail closed
  before any bearer is sent.
- `opencoven cave forget [--json]` deletes the stored Cave credential and its
  authority metadata; missing credentials are a successful no-op, but
  concurrent credential replacement or secure-store read/delete failures stay
  explicit so `deleted: true|false` is emitted only when the result is
  confirmed.
- On Windows, `discover`, `doctor`, `cave pair`, `cave status`, and
  `cave forget` fail closed with `platform_security_unavailable` before Cave
  discovery, secret-store access, or network I/O unless a reviewed native Cave
  path ownership/ACL validator is injected through
  `CliRuntime.cave.discovery.dependencies.windowsPathTrust`.
- `opencoven coven health [--json]` checks the discovered Coven daemon through
  the reviewed SDK transport and fails closed with
  `platform_security_unavailable` until a reviewed native adapter is injected.
- Default command budgets are 10s for `doctor`, `discover`, `cave status`,
  `cave forget`, and `coven health`, plus 30s total for `cave pair` with a 1s
  poll interval.

Human output is written to stdout on success and stderr on failure. JSON output is always written to stdout. All human and JSON output is secret-free: no bearer tokens, pairing secrets, raw discovery files, keychain payloads, or nested causes are emitted.

## Native secure storage

The CLI uses `@napi-rs/keyring` `1.3.0` directly and does not fall back to
files, shell commands, environment variables, or alternate keychain adapters.
`opencoven doctor` verifies native secure storage with a non-destructive probe
against a dedicated keyring account so constructor and backend availability are
exercised without overwriting or deleting a user's real credential. If the
native binding or backend is unavailable, commands fail with the stable error
code `secure_store_unavailable`.

## Native Cave discovery security

The CLI never trusts Windows Cave discovery from pathname metadata, shell
commands, or unchecked ACL guesses. Until a reviewed native validator ships in
the production CLI, default Windows Cave discovery fails closed with
`platform_security_unavailable`. Embedders and tests can keep the default Cave
discovery flow by injecting
`CliRuntime.cave.discovery.dependencies.windowsPathTrust`, plus any other
reviewed discovery dependencies they need.

## Native Coven transport security

The CLI never fabricates Unix peer credentials or Windows named-pipe ownership from discovery metadata, process IDs, filesystem owners, or shell commands. Production `opencoven coven health` and the Coven portion of `opencoven doctor` require a reviewed native `@opencoven/coven-client` `transportSecurity` provider. Embedders can inject that provider through `CliRuntime.coven.transportSecurity`, plus optional `CliRuntime.coven.transport.unix` or `.windows` overrides for reviewed transport dependencies. Without a real adapter, Coven checks fail closed with `platform_security_unavailable` and `opencoven doctor` reports Coven health as unhealthy.

## Compatibility and retry guidance

Cave commands honor the reviewed Client v1 compatibility checks and surface
`incompatible_version` when the local Cave runtime requires a newer CLI. Coven
health accepts only the reviewed exact `coven.daemon.v1` health contract plus
explicit platform-security proof. The CLI never retries automatically. Retry
transient `timeout`, `not_found`, `command_failed`, `connect_failure`,
`service_unavailable`, `rate_limited`
failures after repairing or starting the local runtime as needed; do not retry `secure_store_unavailable`,
`secret_store_read_failed`, `secret_store_delete_failed`,
`platform_security_unavailable`, `owner_mismatch`, `unsafe_endpoint`,
`reconcile_required`, or `incompatible_version` until the underlying
configuration, ownership, authority binding, or version mismatch has been
fixed.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
