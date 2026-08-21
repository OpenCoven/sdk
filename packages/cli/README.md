# @opencoven/dev-cli

The sole owner of the `opencoven` binary in this workspace.

```bash
opencoven --help
opencoven --version
opencoven --json --help
```

Help and version commands are deterministic and do not contact local services.
JSON output includes `command`, `ok`, and `version`. Commands that are not
implemented return exit code `1` with the stable error code `not_implemented`.
Human failures are written to stderr; JSON failures remain machine-readable on
stdout.

## Diagnostics

```bash
opencoven diagnostics
opencoven --json diagnostics
```

Reports the installed CLI version, the Node runtime it is running on, and the
commands this build offers. It contacts nothing: the CLI configures no
transport, so it has no endpoint to describe and no client health to report.

The bundle is assembled from an allowlist and **excludes prompts, tokens,
attachments, and event payloads**. `@opencoven/sdk` produces the same shape for
configured clients — see `sdk.diagnostics()`.

## Shell completions

```bash
opencoven completions bash | tee -a ~/.bashrc      # or: eval "$(opencoven completions bash)"
opencoven completions zsh > "${fpath[1]}/_opencoven"
opencoven completions fish > ~/.config/fish/completions/opencoven.fish
opencoven completions powershell | Out-String | Invoke-Expression
```

The script is printed, never installed, because where a shell loads completions
from differs per shell and per platform. Each script is generated from the same
command and template lists the CLI dispatches on, so it cannot offer a command
the binary rejects.

## Scaffolds

```bash
opencoven scaffold cave-chat ./my-app
opencoven scaffold coven-observer ./my-observer
opencoven scaffold unified-status ./my-status --force
```

| Template | What it starts from |
| --- | --- |
| `cave-chat` | A Cave client on a caller-supplied transport, reading the familiar roster |
| `coven-observer` | A Coven client forwarding operation lifecycle events to an observer |
| `unified-status` | Both clients coordinated through `@opencoven/sdk`, plus a diagnostics bundle |

A scaffold **refuses to overwrite an existing file** and names every conflict;
pass `--force` to replace them. Files are opened with `wx`, so a file that
appears between the check and the write is refused by the kernel rather than
clobbered, and a template path that is not a plain relative path is rejected
before anything is created.

The SDK packages are unpublished, so a generated scaffold installs them from
packed tarballs — its README says how. `pnpm verify:package` proves this end to
end: it generates every scaffold, installs the freshly packed tarballs into it
offline, compiles it, and runs it.

## Browser applications

A browser cannot connect to Cave or Coven directly in v1. Both clients take a
caller-supplied transport and never discover an endpoint or a credential, so a
browser would have to hold the credential itself and reach an origin the daemons
do not serve. Run a scaffold in a server-side runtime you control and let the
browser talk to that.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
