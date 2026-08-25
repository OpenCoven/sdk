# SDK Release Readiness Design

**Status:** Historical baseline; package scope superseded by SDK #37
**Date:** 2026-08-19

> The release architecture remains valid, but references to five public
> packages are historical. The active 0.1 release inventory contains four
> packages and excludes the private `@opencoven/dev-cli` workspace. See the
> [current read-only release design](2026-08-22-sdk-0.1-read-only-release-design.md).

## Goal

Make the OpenCoven SDK operationally ready for a controlled public release
without making any package publishable as part of this phase. The repository
must gain a deterministic versioning workflow, reproducible release artifacts,
provenance-ready automation, explicit support and security policies, and
tested rollback and incident procedures.

Actual npm publication remains locked until a later launch pull request and
protected release-environment approval.

## Current Constraints

- All five npm package names are currently unpublished.
- Every public package manifest has `"private": true`.
- `prepublishOnly` requires `OPENCOVEN_RELEASE_AUTHORIZATION=publish`.
- The repository has no GitHub release history and no npm release environment.
- npm trusted publishing cannot be configured until each package exists on the
  registry, so the first publication needs a separately approved bootstrap
  procedure.
- The SDK currently supports Node `>=24.18.0 <25` and builds for Node 24.
- The packages use one aligned version and workspace-exact internal ranges.

## Chosen Approach: Two-Key Locked Release System

Release readiness uses two independent locks:

1. **Repository lock:** release configuration remains disabled and every
   package remains private. Unlocking requires a reviewed code change.
2. **Deployment lock:** the publish job uses a protected GitHub environment.
   Unlocking requires external environment approval and npm publisher setup.

Neither repository variables nor workflow inputs can bypass the repository
lock. Pull requests and ordinary pushes never receive `id-token: write` or
publish permissions.

## Supported Runtime Matrix

The first supported line is Node 24 only:

- minimum: Node `24.18.0`;
- CI floor: exact Node `24.18.1`, matching `.node-version`;
- CI moving target: latest available `24.x`;
- package engine: `>=24.18.0 <25`;
- Node 22 is excluded because the SDK targets Node 24 and has not been
  qualified on Node 22;
- Node 26 remains unsupported while it is Current and requires a separate
  compatibility decision after it becomes LTS.

The full canonical verifier runs at the minimum version. A second CI job runs
build, typecheck, unit/contract tests, and package verification on latest
`24.x` so regressions in the supported major are visible without silently
expanding the support promise.

## Versioning and Changelog Workflow

Use Changesets for fixed-version monorepo releases.

- All five public packages belong to one fixed group.
- Internal `@opencoven/*` dependencies remain exact workspace versions.
- Private packages may be versioned but never published while locked.
- Each package receives a `CHANGELOG.md` and includes it in its tarball.
- Contributors add a changeset for user-visible package changes.
- `pnpm release:version` consumes changesets and updates package versions,
  internal ranges, and changelogs.
- `pnpm release:status` provides a deterministic release summary.

The root remains private and is not an independently released package.

## Release Contract

Add `release.config.json` as the machine-readable release contract:

```json
{
  "schemaVersion": 1,
  "publishingEnabled": false,
  "tagPrefix": "sdk-v",
  "npmAccess": "public",
  "npmDistTag": "latest",
  "githubEnvironment": "npm-release",
  "supportedNode": {
    "minimum": "24.18.0",
    "major": 24
  },
  "packages": [
    "@opencoven/sdk-core",
    "@opencoven/cave-client",
    "@opencoven/coven-client",
    "@opencoven/sdk",
    "@opencoven/dev-cli"
  ]
}
```

`scripts/verify-release-readiness.mjs` validates:

- exact schema and package list;
- fixed package versions;
- exact internal dependency ranges;
- Node engines and build targets;
- private/publishing lock consistency;
- release workflow name and environment;
- changelog inclusion;
- package metadata, licenses, exports, and CLI ownership;
- tag/version agreement when a release version is supplied;
- launch mode cannot run while any repository lock remains.

The canonical `pnpm verify` includes this network-free verifier.

## Artifact Pipeline

`scripts/create-release-artifacts.mjs` reuses the existing public package packer
and owned temporary-directory helpers. It produces:

- one tarball per public package;
- `release-manifest.json` containing package name, version, tarball filename,
  byte size, and SHA-256 digest;
- deterministic package ordering;
- no source files or undeclared dependencies.

The script accepts an explicit output directory for CI and otherwise uses an
owned temporary directory. It never publishes.

The existing packed-consumer verifier remains authoritative for install,
compile, import, runtime, license, and example behavior.

## GitHub Release Workflow

Add a full-SHA-pinned `.github/workflows/release.yml` with manual dispatch:

- input `mode`: `verify` or `publish`;
- input `version`: exact SemVer;
- runs only from `main`;
- verifies that `sdk-v<version>` points at the dispatched commit;
- installs from the frozen lockfile;
- runs the canonical verifier;
- creates release tarballs and checksum manifest;
- uploads the release bundle.

The verification job has `contents: read`. The publish job alone receives:

```yaml
permissions:
  contents: read
  id-token: write
  attestations: write
```

The publish job uses environment `npm-release` and fails before requesting
registry access unless:

- `mode` is `publish`;
- `publishingEnabled` is `true`;
- every package has `"private": false`;
- the version and tag match all package manifests;
- the working tree is clean after build and version verification.

After all gates pass, the publish job downloads the verified bundle, creates
GitHub build-provenance attestations for its tarballs, and publishes those exact
bytes.

Regular publishing uses npm trusted publishing and no `NPM_TOKEN`. npm
provenance is mandatory.

## First-Publish Bootstrap

Because the package names do not yet exist on npm, trusted publishers cannot
be configured before the first publication. The launch runbook therefore
separates bootstrap from normal releases:

1. Reserve and verify the `@opencoven` organization and package ownership.
2. Approve the launch pull request that unlocks repository publishing.
3. Produce and attest the exact release artifacts in GitHub Actions.
4. Use a one-time, least-privilege npm credential with mandatory 2FA to publish
   those exact artifacts.
5. Configure each package's trusted publisher for
   `OpenCoven/sdk`, `.github/workflows/release.yml`, and `npm-release`.
6. Revoke and delete the bootstrap credential immediately.
7. Verify registry provenance and package ownership.
8. Use only OIDC trusted publishing for every later release.

This phase documents and validates the procedure but does not create npm
credentials, environments, trusted publishers, tags, releases, or packages.

## Support, Security, Deprecation, and Compatibility

Add:

- `SUPPORT.md`: supported Node line, support channels, issue requirements,
  best-effort response expectations, and scope boundaries;
- `SECURITY.md`: private vulnerability reporting, supported SDK versions,
  disclosure expectations, and secret-handling guidance;
- `RELEASING.md`: versioning, bootstrap, regular releases, attestations,
  validation, rollback, and incident response;
- package changelogs generated by Changesets.

For pre-1.0 releases:

- only the latest minor line is supported;
- additive APIs are preferred;
- breaking changes require a minor release and migration notes;
- deprecated APIs remain for at least one subsequent minor unless retention
  would preserve a security vulnerability;
- security fixes may shorten the deprecation window.

## Rollback and Incident Response

npm versions are immutable and releases are not treated as deletable.

For a bad release:

1. stop the GitHub release environment;
2. disable repository publishing in a reviewed emergency change;
3. deprecate the affected npm version with a corrective message;
4. publish a fixed version from a clean commit;
5. update the GitHub release and changelogs;
6. notify affected consumers through the security or support channel.

For suspected compromise:

1. suspend the release environment and trusted publishers;
2. revoke any bootstrap or residual credentials;
3. preserve workflow logs, artifacts, attestations, and commit evidence;
4. assess package contents and provenance;
5. publish an advisory and fixed release when appropriate;
6. document root cause and preventive actions.

## Dependency Maintenance

Replace the placeholder Dependabot configuration with valid weekly updates for:

- pnpm at repository root;
- GitHub Actions in `/.github/workflows`.

Group safe development dependency updates where supported, retain full action
SHA pinning, and keep security updates independently reviewable.

## Testing Strategy

Add focused tests for:

- release configuration schema and fail-closed defaults;
- Node minimum/latest CI matrix;
- full-SHA action pinning and least workflow permissions;
- absence of `NPM_TOKEN`;
- exact release environment and tag checks;
- package version and internal-range alignment;
- changeset fixed-group configuration;
- changelog presence and packed inclusion;
- deterministic artifact manifest ordering, digests, and cleanup;
- launch rejection while packages remain private;
- release tag/version mismatch;
- corrected Dependabot ecosystems;
- documentation policy completeness.

Run the canonical verifier, pre-commit, Gitleaks, `pnpm audit`, and
`git diff --check` before opening the pull request.

## Non-Goals

- Publishing any package or reserving npm names.
- Creating npm credentials or trusted-publisher settings.
- Creating or modifying GitHub environments or branch protection.
- Supporting Node 22 or Node 26.
- Automatic releases from merges to `main`.
- Automatic retries, runtime API changes, or persistent credential storage.
- Committing generated release tarballs.

## Completion Criteria

- Release artifacts are reproducible, checksummed, and attestable.
- The canonical verifier catches release metadata drift.
- CI covers the minimum and latest patch of supported Node 24.
- Versioning and changelog generation are deterministic.
- Publish mode fails closed while the repository lock remains.
- The workflow grants OIDC/attestation permissions only to the protected
  publish job.
- Support, security, deprecation, rollback, and incident policies are explicit.
- Dependabot configuration is valid.
- Existing runtime behavior and package boundaries remain unchanged.
