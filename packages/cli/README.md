# @opencoven/dev-cli

The sole owner of the `opencoven` binary in this workspace.

```bash
opencoven --help
opencoven doctor
opencoven discover --json
opencoven cave pair
opencoven cave status
opencoven cave forget
opencoven coven health
```

## Command contract

- `opencoven doctor [--json]` reports secret-free Cave, Coven, and secure-store diagnostics.
- Every operational command enforces an explicit deadline; `opencoven cave pair` preserves one absolute workflow budget across create, poll, and exchange.
- `opencoven discover [--json]` reports reviewed runtime discovery metadata only.
- `opencoven cave pair [--json]` creates, polls, and exchanges a Cave pairing request and stores the credential through the native keyring only.
- `opencoven cave status [--json]` validates the stored Cave credential against the current authority binding.
- `opencoven cave forget [--json]` deletes the stored Cave credential and its authority metadata.
- `opencoven coven health [--json]` checks the discovered Coven daemon through the reviewed SDK transport and fails closed with `platform_security_unavailable` until a reviewed native adapter is injected.

Human output is written to stdout on success and stderr on failure. JSON output is always written to stdout. All human and JSON output is secret-free: no bearer tokens, pairing secrets, raw discovery files, keychain payloads, or nested causes are emitted.

## Native secure storage

The CLI uses `@napi-rs/keyring` directly and does not fall back to files, shell commands, environment variables, or alternate keychain adapters. `opencoven doctor` verifies native secure storage with a non-destructive probe against a dedicated keyring account so constructor and backend availability are exercised without overwriting or deleting a user's real credential. If the native binding or backend is unavailable, commands fail with the stable error code `secure_store_unavailable`.

## Native Coven transport security

The CLI never fabricates Unix peer credentials or Windows named-pipe ownership from discovery metadata, process IDs, filesystem owners, or shell commands. Production `opencoven coven health` and the Coven portion of `opencoven doctor` require a reviewed native `@opencoven/coven-client` `transportSecurity` provider. Embedders can inject that provider through `CliRuntime.coven.transportSecurity`, plus optional `CliRuntime.coven.transport.unix` or `.windows` overrides for reviewed transport dependencies. Without a real adapter, Coven checks fail closed with `platform_security_unavailable` and `opencoven doctor` reports Coven health as unhealthy.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
