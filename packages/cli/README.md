# @opencoven/dev-cli

The sole owner of the `opencoven` binary in this workspace.

```bash
opencoven --help
opencoven --version
opencoven --json --help
```

Help and version commands are deterministic and do not contact local services.
JSON output includes `command`, `ok`, and `version`. Operational commands are
reserved for future work and currently return exit code `1` with the stable
error code `not_implemented`.
