# Contributing

OpenCoven SDK is experimental and keeps its public contracts deliberately
narrow. Prefer focused changes with explicit compatibility and security
behavior.

## Development

Use the pinned Node and pnpm versions:

```bash
corepack pnpm@10.34.0 install --frozen-lockfile
```

Write or update a focused test before changing behavior. Then run the smallest
relevant test command while iterating. Before opening a pull request, run:

```bash
corepack pnpm@10.34.0 verify
git diff --check
```

The verifier covers typechecking, tests, builds, contract and package checks,
release readiness, coverage, property stress tests, and linting.

## Public contracts

- Keep Cave, Coven, core, SDK, and CLI responsibilities separate.
- Preserve import purity: packages must not perform discovery, credential
  lookup, filesystem, network, or daemon I/O at import time.
- Validate untrusted transport responses before exposing them.
- Keep normalized observer and error metadata allowlisted.
- Refresh reviewed contract fixtures with `pnpm sync:contracts` only from the
  authoritative repositories and review the resulting bytes and digests.
- Keep the packed API baselines unchanged unless the public contract change is
  intentional. For an approved change, run
  `corepack pnpm@10.34.0 api:baseline:update`, review the declaration and export
  diff, and include matching tests, docs, and a Changeset.

See [COMPATIBILITY.md](COMPATIBILITY.md) for the supported surface and
deprecation policy.

## Changesets

Add a Changeset for each user-visible package behavior change:

```bash
corepack pnpm@10.34.0 changeset
corepack pnpm@10.34.0 release:status
```

Documentation, tests, and internal maintenance that do not affect a published
package contract generally do not require one. All public packages use fixed
versions; do not alter internal workspace ranges independently.

## Security and privacy

Do not commit credentials, tokens, private keys, private endpoints, or raw
sensitive SDK error causes. Follow [SECURITY.md](SECURITY.md) for vulnerability
reports. Release configuration, publishing workflows, discovery, and local IPC
transport changes require especially careful review.

## Pull requests

Keep each pull request scoped to one coherent change. Explain the observable
behavior, compatibility impact, validation performed, and any release
implications. Do not combine generated output or unrelated cleanup with the
change.
