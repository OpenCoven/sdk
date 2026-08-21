---
'@opencoven/sdk-core': minor
'@opencoven/cave-client': minor
'@opencoven/coven-client': minor
'@opencoven/sdk': minor
'@opencoven/dev-cli': minor
---

Add sanitized diagnostics bundles, shell completions, and TypeScript scaffolds.

`@opencoven/sdk-core` gains `createDiagnosticsBundle()`, which reduces versions,
capabilities, endpoints, operation events, and normalized errors to a bundle
that is safe to paste into an issue. It is built from an allowlist and excludes
prompts, tokens, attachments, and event payloads.

`CaveClient.capabilities()` and `CovenClient.capabilities()` report which
operations a caller-supplied transport implements, without contacting anything.
`sdk.diagnostics()` composes them with a concurrent health check.

`opencoven` gains `diagnostics`, `completions <bash|zsh|fish|powershell>`, and
`scaffold <cave-chat|coven-observer|unified-status> <directory>`. Scaffolds
refuse to overwrite existing files unless `--force` is given, and the packed
package verifier compiles and runs every one of them against freshly packed
tarballs.
