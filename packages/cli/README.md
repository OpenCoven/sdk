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
- `opencoven discover [--json]` reports reviewed runtime discovery metadata only.
- `opencoven cave pair [--json]` creates, polls, and exchanges a Cave pairing request and stores the credential through the native keyring only.
- `opencoven cave status [--json]` validates the stored Cave credential against the current authority binding.
- `opencoven cave forget [--json]` deletes the stored Cave credential and its authority metadata.
- `opencoven coven health [--json]` checks the discovered Coven daemon through the SDK transport.

Human output is written to stdout on success and stderr on failure. JSON output is always written to stdout. All human and JSON output is secret-free: no bearer tokens, pairing secrets, raw discovery files, keychain payloads, or nested causes are emitted.

## Native secure storage

The CLI uses `@napi-rs/keyring` directly and does not fall back to files, shell commands, environment variables, or alternate keychain adapters. If the native binding or backend is unavailable, commands fail with the stable error code `secure_store_unavailable`.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
