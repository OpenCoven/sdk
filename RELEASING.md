# Release process

The repository contains release-readiness automation. The reviewed 0.1.0
release-unlock change deliberately opens the repository publication lock —
`publishingEnabled` is `true` in `release.config.json` and the four release
package manifests are publishable — while the second, independent deployment
lock remains in force: a normal publication still requires the protected
GitHub environment `npm-release` to approve the publish job. Opening the
repository lock does not create npm package records, configure GitHub
environments, or register trusted publishers, and it does not by itself tag,
publish, or unlock anything externally; activation happens only through the
maintainer-authorized `sdk-v<version>` tag and a release-workflow dispatch
from `main`.

`@opencoven/dev-cli` is not part of the 0.1 release group. Release tooling must
not pack, publish, attest, or configure a trusted publisher for it.

## 1. Release locks and prerequisites

A normal publication requires both independent locks to be open:

1. reviewed repository changes set `publishingEnabled` to `true` in
   `release.config.json` and set the four release package manifests to
   non-private;
2. the protected GitHub environment `npm-release` approves the publish job.

For 0.1, `release.config.json` also freezes the native Chat/real-authority
conformance matrix to `darwin-arm64`, `linux-x64`, and `win32-x64`. That
release-gate matrix is narrower than the published package Node runtime
support and does not by itself authorize release; #38 still requires one
passing evidence record for each target.

After the native consumer has produced those three records, validate and
combine them with `corepack pnpm@10.34.0 conformance:aggregate -- ...` as
documented in
[`docs/workflows/client-v1-cross-repository-conformance.md`](docs/workflows/client-v1-cross-repository-conformance.md).
The SDK command imports Cave's exact locked assertion engine and validates
already-completed evidence; it does not execute a platform journey or change
release state.

Before unlocking, create and protect the `npm-release` environment, confirm
branch protections and required checks, confirm npm organization ownership,
and complete the first-publish/trusted-publisher prerequisites below.

## 2. Changesets and fixed versions

Add a Changeset for every published behavior change:

```bash
corepack pnpm@10.34.0 changeset
corepack pnpm@10.34.0 release:status
```

The four release packages are one fixed-version group. Review the requested bump and
run `corepack pnpm@10.34.0 release:version` on a dedicated release-preparation
branch. Confirm identical package versions, exact
`workspace:<fixedVersion>` internal ranges, and updated changelogs.
The private CLI is outside this fixed group.

## 3. Clean verification

From a clean checkout of the reviewed commit:

```bash
corepack pnpm@10.34.0 install --frozen-lockfile
corepack pnpm@10.34.0 verify
git diff --exit-code
```

Do not release with uncommitted build output or a modified lockfile.
Review every change under `api-baselines/` against its implementation,
Changeset, migration guidance, and compatibility impact. Release preparation
must not regenerate baselines merely to make verification pass.

## 4. Tag

Create the annotated tag `sdk-v<version>` only after the reviewed release
commit is on `main`. The release workflow verifies that the tag resolves to
the exact checked-out `HEAD`.

## 5. Verify-mode workflow

Run `.github/workflows/release.yml` from `main` with mode `verify` and the
exact fixed version. It performs canonical verification, validates the tag,
creates four tarballs plus `release-manifest.json`, verifies every digest, and
uploads the immutable workflow artifact. Verify mode never publishes.

## 6. First-publish bootstrap

npm trusted publishing cannot be configured before each package exists.
Therefore the **First-publish bootstrap** is a separate, explicitly approved
one-time operation:

1. use a least-privilege npm automation credential protected by account 2FA;
2. publish the four reviewed tarballs in canonical order, without rebuilding;
3. verify package ownership, contents, versions, and provenance expectations;
4. immediately revoke the bootstrap credential and preserve the audit record.

Do not add that credential to repository secrets, workflow files, shell
history, or normal release automation.

## 7. Configure trusted publishers

For each package, configure npm's trusted publisher to the `OpenCoven/sdk`
repository and `.github/workflows/release.yml`. Restrict publishing to the
protected `npm-release` GitHub environment where supported. Confirm all four:

- `@opencoven/sdk-core`
- `@opencoven/cave-client`
- `@opencoven/coven-client`
- `@opencoven/sdk`

## 8. Normal OIDC publication

After bootstrap, normal releases use workflow mode `publish`. The protected
job obtains short-lived OIDC identity, attests the preflight tarballs, and
publishes those exact files. `NPM_TOKEN` and `NODE_AUTH_TOKEN` fallback are
forbidden. The workflow must never rebuild or repack in the publish job.

## 9. Registry and provenance validation

After publication, verify:

- all four registry versions and `latest` dist-tags;
- package manifests, licenses, changelogs, binaries, and dependency ranges;
- SHA-256 values against `release-manifest.json`;
- npm provenance and GitHub build attestations;
- installation and imports in a clean consumer.

Record the workflow run, commit, tag, manifest, attestations, and verification
results in the release notes.

## 10. Rollback

npm versions are immutable. Do not unpublish except where npm policy and a
security/legal emergency explicitly require it. For a defective release,
deprecate the affected versions with a clear message, move the dist-tag only
after review, and publish a corrective fixed-version release.

## 11. Release incident response

For a suspected compromise or incorrect publication:

1. suspend the `npm-release` environment and stop active workflows;
2. revoke bootstrap credentials, npm sessions, and any affected identities;
3. preserve workflow logs, manifests, attestations, audit events, and package
   bytes as evidence;
4. assess installed-package impact and publish an advisory when appropriate;
5. deprecate affected versions and issue a corrective release;
6. complete a blameless postmortem before restoring publication.

Security disclosure follows [SECURITY.md](SECURITY.md).
