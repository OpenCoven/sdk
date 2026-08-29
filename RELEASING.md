# Release process

The repository contains release-readiness automation, but this phase does not publish packages.
It does not create npm package records, configure GitHub
environments, or register trusted publishers. The four-package 0.1 release
group and the private CLI workspace all remain private, and the repository
publication lock remains closed.

`@opencoven/dev-cli` is not part of the 0.1 release group. Release tooling must
not pack, publish, attest, or configure a trusted publisher for it.

## 1. Release locks and prerequisites

A normal publication requires both independent locks to be open:

1. reviewed repository changes set `publishingEnabled` to `true` in
   `release.config.json`, set the four release package manifests to
   non-private, and leave the exact release workflow, candidate job, npm
   registry, and npm CLI version pinned;
2. the protected GitHub environment `npm-release` approves the publish job.

`release.config.json` deliberately identifies two different artifact sets:

- `conformanceEvidence.artifactSet` is `conformance-candidate`. Its frozen
  schema-v1 `release-manifest.json` and tarball digests were produced from the
  exact private SDK candidate consumed by Chat. Those bytes are conformance
  inputs only and must never be submitted to npm.
- `publicationCandidate.artifactSet` is `publication-candidate`. Its
  workflow and job identify the dedicated verify-mode producer. No commit or
  #40 comment is written into a descendant configuration commit.

Publication artifacts use schema version 3 from
[`conformance/release-artifact-manifest.schema.json`](conformance/release-artifact-manifest.schema.json).
The exact release commit produces these bytes before SHIP authorization. The
manifest carries its commit/tree, the reviewed repository `.npmrc` digest, the
Node/pnpm/npm pack toolchain, the exact workflow commit/ref/run attempt/job,
the unique commit-derived artifact name, and every tarball filename, size, and
SHA-256. It contains no security-review claim.

After that immutable artifact exists, #40 reviews the raw
`release-manifest.json` bytes and all four tarballs. The selected comment ID is
a publish-dispatch input, not a repository change. Publication fetches #40 and
the exact comment through `gh api`, requires the issue to be closed, completed,
and locked, and accepts only unedited canonical JSON from CODEOWNER `BunsDev`.
The record binds the exact source commit/tree, raw manifest size/SHA-256,
ordered package entries, pack toolchain, workflow/run attempt/job ID, and
GitHub artifact ID/name. Matching source content, a descendant commit, or a
freshly repacked equivalent archive cannot authorize different bytes.

The comment body is recursively key-sorted, two-space-indented JSON with one
trailing newline. Its shape is:

```json
{
  "artifact": {
    "id": "<artifact-id>",
    "name": "opencoven-sdk-publication-<release-commit>-<version>"
  },
  "disposition": "ship",
  "issue": "OpenCoven/sdk#40",
  "kind": "opencoven-sdk-publication-security-review",
  "manifest": {
    "file": "release-manifest.json",
    "sha256": "<raw-manifest-sha256>",
    "size": "<raw-manifest-size>"
  },
  "packages": [
    "<the four exact ordered filename/size/SHA-256 entries>"
  ],
  "provenance": {
    "job": "publication-candidate",
    "jobId": "<job-id>",
    "repository": "OpenCoven/sdk",
    "runAttempt": "<run-attempt>",
    "runId": "<run-id>",
    "sourceRef": "refs/heads/main",
    "workflow": ".github/workflows/release.yml",
    "workflowCommit": "<release-commit>"
  },
  "schemaVersion": 2,
  "source": {
    "commit": "<release-commit>",
    "repository": "OpenCoven/sdk",
    "tree": "<release-tree>"
  },
  "toolchain": {
    "nodeVersion": "v24.18.1",
    "npmVersion": "11.5.1",
    "packCommand": "corepack pnpm@10.34.0 pack --ignore-scripts",
    "pnpmVersion": "pnpm@10.34.0"
  },
  "version": "<version>"
}
```

For 0.1, `release.config.json` also freezes the native Chat/real-authority
conformance matrix to `darwin-arm64`, `linux-x64`, and `win32-x64`. That
release-gate matrix is narrower than the published package Node runtime
support and does not by itself authorize release; #38 still requires one
passing evidence record for each target.

The frozen Chat commit
`dbbcf3a71155730f0e707e181ef3ca7e770c719f` has no schema-v2 platform
evidence producer. It contains only the older contract canary, so there is no
truth-preserving adapter for the required platform, Cave, SDK, Chat, isolation,
scan, and protected-job claims. Aggregation and release readiness intentionally
fail closed until a reviewed lock update names an existing exact compatible
producer commit and protected workflow, as documented in
[`docs/workflows/client-v1-cross-repository-conformance.md`](docs/workflows/client-v1-cross-repository-conformance.md).

Before advancing this candidate after that blocker is resolved, copy the
canonical aggregate to
`docs/client-v1-cross-repository-results/acc38488f00860d246c3c553375634d64806eabb.json`,
and add the sibling reviewed evidence index
`docs/client-v1-cross-repository-results/acc38488f00860d246c3c553375634d64806eabb.index.json`.
The index is a reviewed locator and expected-value record, not an
authentication oracle. Release readiness uses the standard GitHub workflow
token to fetch the exact Chat workflow bytes, run, job, and artifact records
through `gh api`; downloads each named artifact with `gh run download`;
downloads its attestation bundle; and invokes:

```bash
gh attestation verify <artifact> \
  --repo OpenCoven/chat \
  --signer-workflow OpenCoven/chat/<locked-workflow-path> \
  --signer-digest <locked-producer-commit> \
  --source-digest <locked-producer-commit> \
  --predicate-type https://slsa.dev/provenance/v1 \
  --deny-self-hosted-runners \
  --bundle <attestation-bundle> \
  --format json
```

The verifier requires the exact frozen repository, workflow path, source ref,
commit, run attempt, job ID/name, protected environment, hosted-runner labels,
artifact name, and successful conclusions. It also checks the certificate's
GitHub-hosted runner and run-invocation URI, the downloaded record digest, the
attestation subject digest, and the downloaded bundle digest. Only those
downloaded canonical record bytes are passed to the SDK aggregator. The
resulting canonical aggregate must byte-match the committed aggregate.

A committed aggregate/index pair, including plausible run, job, artifact, or
attestation IDs, can never satisfy release readiness by itself. This
implementation has no offline acceptance mode: without live authoritative
GitHub verification, readiness remains blocked. Set
`release.config.json` `conformanceEvidence.aggregateRecord` only in the same
reviewed change that adds the aggregate and sibling index.

Then run:

```bash
corepack pnpm@10.34.0 verify:release
```

The CLI requires named evidence even when no flag is supplied. The current
value remains `null`, so candidate advancement fails specifically for missing
evidence. A configured record must be a committed, clean regular file at the
exact candidate path with its committed sibling index. Release readiness
requires exact Node `v24.18.1` from `.node-version`, revalidates the lock,
schema, registry, validator, candidate, and authoritative primary-record
bytes, then uses the exact clean frozen Cave checkout to re-render Cave
records. This does not open `publishingEnabled`, change package privacy, create
a tag, or authorize npm.

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
exact fixed version. Both verify and publish preflight require named evidence.
Before any repository-controlled dependency installation, the workflow checks
that `.node-version`, the aggregate/index, workflow, authoritative GitHub
verifier, artifact schema, builder, publisher, package lock, and their runtime
dependencies are byte-equal to the recorded validator commit. It checks out
the exact frozen Cave authority and performs the live GitHub artifact download
and GitHub artifact attestation verification described above. That
token-bearing check runs before
dependency installation. Repository builds, tests, coverage, package
verification, stress checks, and lint then run through `verify:repository`
in a separate contents-only job without `GH_TOKEN`; checkout credentials are
never persisted. The publish job requires both the authoritative/artifact
preflight and repository-verification jobs.

When `publishingEnabled` is opened on the exact non-private release commit,
verify mode runs the dedicated `publication-candidate` job. It clones that
exact `HEAD`, installs its frozen dependency lock, builds and packs with
scripts disabled, creates four tarballs, rejects `private: true`,
`publishConfig`, and publish lifecycle scripts, and writes the schema-v3
publication manifest. Candidate creation does not require SHIP. The job
has no OIDC or attestation-write permission and uploads exactly
`opencoven-sdk-publication-<commit>-<version>`. Verify mode never publishes.

After #40 reviews those exact bytes, publish mode must run again from the same
commit and tree. It resolves the immutable comment, verifies the successful
candidate workflow run and exact numeric job and artifact IDs, downloads that
prior artifact by reviewed run/name, and byte-verifies the raw manifest and
every tarball. It never rebuilds or repacks. A gzip header, compression-level,
filename, size, digest, workflow run, artifact, commit, or tree change requires
new candidate bytes and a new #40 review.

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
job obtains short-lived OIDC identity, attests the downloaded reviewed
tarballs, and publishes those exact files. It uses pinned npm `11.5.1`, rejects
`NPM_TOKEN` and `NODE_AUTH_TOKEN`, and discards inherited npm config, proxy,
certificate override, lifecycle, and unrelated GitHub-token inputs. Each
tarball is copied byte-for-byte into an owner-private temporary directory
outside the checkout. npm runs there with generated private user/global
configs and cache, registry pinned by config and CLI to
`https://registry.npmjs.org/`, strict certificate validation, no auth token or
`always-auth`, and `--ignore-scripts`. GitHub's two short-lived OIDC request
variables, a fixed non-secret `GITHUB_ACTIONS=true` provider marker, and only
the validated repository/workflow/ref/commit/run/hosted-runner fields required
for npm's SLSA provenance reach npm. Resolved npm config is checked before the
first publish. The workflow must never rebuild or repack in the publish job.

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
