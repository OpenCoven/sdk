# Release process

The repository contains release-readiness automation, but this phase does not publish packages.
It does not create npm package records, configure GitHub
environments, or register trusted publishers. The four-package 0.1 release
group and the private CLI workspace all remain private, and the repository
publication lock remains closed.

`@opencoven/dev-cli` is not part of the 0.1 release group. Release tooling must
not pack, publish, attest, or configure a trusted publisher for it.

## 1. Release locks and prerequisites

A normal publication requires every independent lock to be open:

1. reviewed repository changes set `publishingEnabled` to `true` in
   `release.config.json`, set the four release package manifests to
   non-private, and leave the exact release workflow, candidate job, npm
   registry, npm CLI version, isolated attestation jobs, and final
   `npm-publish` trusted-publisher environment pinned;
2. authoritative GitHub API verification confirms the immutable
   `OpenCoven/sdk` repository identity and the exact live policies for
   `publication-candidate`, `npm-release`, and `npm-publish`;
3. #40 authorizes the exact publication candidate bytes, annotated tag object
   ID, and verified environment policy receipt through an immutable
   comment by GitHub user ID `68980965`, whose current repository association
   and role must remain `MEMBER` and `admin`;
4. the pending `npm-release` deployment is captured by an attested witness,
   then the protected `approval-evidence` job produces an approval receipt
   that its isolated successor attests as described below.

`release.config.json` deliberately identifies two different artifact sets:

- `conformanceEvidence.artifactSet` is `conformance-candidate`. Its frozen
  schema-v1 `release-manifest.json` and tarball digests were produced from the
  exact private SDK candidate consumed by Chat. Those bytes are conformance
  inputs only and must never be submitted to npm.
- `publicationCandidate.artifactSet` is `publication-candidate`. Its
  workflow, unprivileged producer job, isolated attestation job, and
  `publication-candidate` environment identify the dedicated verify-mode
  evidence chain. No commit or #40 comment is written into a descendant
  configuration commit.

Publication artifacts use schema version 6 from
[`conformance/release-artifact-manifest.schema.json`](conformance/release-artifact-manifest.schema.json).
The exact release commit produces these bytes before SHIP authorization. The
manifest carries its commit/tree, the reviewed repository `.npmrc` digest, the
conformance candidate commit/tree and canonical publication-source manifest,
the Node/pnpm/npm pack toolchain, the sterile publisher's exact runtime path,
size, and SHA-256, the exact workflow commit/ref/run attempt/job/environment,
the unique commit-derived artifact name, and every tarball filename, size,
and SHA-256. It contains no security-review claim.

`conformanceEvidence.runtimeManifestSha256` freezes a canonical manifest over
all public-package sources and fixtures, package build configuration, API
baselines, workspace dependency manifests and lockfile, `.node-version`,
`.npmrc`, `pnpm-workspace.yaml`, and `tsconfig.base.json`. Package versions,
`private`, exact internal `workspace:<version>` ranges, changelogs, Changesets,
and release configuration are the only release-metadata exceptions. Candidate
creation verifies the descendant release commit against that digest, clones
the exact #38 candidate commit, applies only that deterministic metadata
transform, and builds from the transformed candidate checkout. Any other
source, dependency, fixture, API-baseline, or build change requires new #38
evidence and a new #40 review.

After that immutable artifact exists, #40 reviews the raw
`release-manifest.json` bytes and all four tarballs. The selected comment ID is
a publish-dispatch input, not a repository change. Publication fetches #40 and
the exact comment through `gh api`, requires the issue to be closed, completed,
and locked, and accepts only unedited canonical JSON whose author has immutable
GitHub user ID `68980965`. The login is informational and may be renamed; the
comment's `author_association` must be `MEMBER`, and the collaborators API must
report the same numeric user ID with `admin` permission and role.
The record binds the exact source commit/tree, annotated `sdk-v<version>` tag
object ID and peeled commit/tree, raw manifest size/SHA-256, ordered package
entries, pack toolchain, sterile publisher runtime,
workflow/run attempt/job ID, environment ID, deployment ID, and GitHub
artifact ID/name/archive digest. It separately binds the successful
`publication-candidate-attestation` job and the exact attestation-bundle
artifact ID/name/archive digest plus raw `attestation.json` size/SHA-256.
It also embeds the complete canonical environment policy receipt, including
the immutable repository and owner IDs, all three environment IDs, policy
timestamps, reviewer IDs, self-review settings, administrator-bypass settings,
wait timers, deployment branch policy, protection-rule set, and per-environment
and aggregate policy digests.
Matching source content, a descendant commit, a different attestation bundle,
or a freshly repacked equivalent archive cannot authorize different bytes.

The comment body is recursively key-sorted, two-space-indented JSON with one
trailing newline. Its shape is:

```json
{
  "artifact": {
    "digest": "sha256:<GitHub Actions artifact archive digest>",
    "id": "<artifact-id>",
    "name": "opencoven-sdk-publication-<release-commit>-<version>"
  },
  "attestation": {
    "bundle": {
      "artifactDigest": "sha256:<GitHub Actions bundle archive digest>",
      "artifactId": "<bundle-artifact-id>",
      "artifactName": "opencoven-sdk-publication-attestation-<release-commit>-<version>",
      "file": "attestation.json",
      "sha256": "<raw-attestation-bundle-sha256>",
      "size": "<raw-attestation-bundle-size>"
    },
    "job": "publication-candidate-attestation",
    "jobId": "<attestation-job-id>"
  },
  "disposition": "ship",
  "environmentPolicy": {
    "environments": [
      "<exact ordered publication-candidate, npm-release, and npm-publish policy snapshots>"
    ],
    "kind": "opencoven-sdk-release-environment-policy",
    "policyDigest": "<aggregate-environment-policy-sha256>",
    "repository": {
      "defaultBranch": "main",
      "fullName": "OpenCoven/sdk",
      "id": "1337664127",
      "name": "sdk",
      "nodeId": "R_kgDOT7sifw",
      "owner": {
        "id": "270919577",
        "login": "OpenCoven",
        "type": "Organization"
      },
      "private": false
    },
    "schemaVersion": 1,
    "verifiedAt": "<verification-timestamp>"
  },
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
  "reviewer": {
    "authorAssociation": "MEMBER",
    "id": 68980965,
    "permission": "admin",
    "roleName": "admin"
  },
  "publisher": {
    "path": "scripts/publish-release-artifacts.mjs",
    "sha256": "<publisher-sha256>",
    "size": "<publisher-size>"
  },
  "provenance": {
    "deploymentId": "<deployment-id>",
    "environment": "publication-candidate",
    "environmentId": "<environment-id>",
    "job": "publication-candidate",
    "jobId": "<job-id>",
    "repository": "OpenCoven/sdk",
    "runAttempt": "<run-attempt>",
    "runId": "<run-id>",
    "sourceRef": "refs/heads/main",
    "workflow": ".github/workflows/release.yml",
    "workflowCommit": "<release-commit>"
  },
  "schemaVersion": 8,
  "source": {
    "commit": "<release-commit>",
    "repository": "OpenCoven/sdk",
    "runtimeManifest": {
      "candidateCommit": "1597835325cf3762b51408ff0a565037eeb25f64",
      "candidateTree": "f2c2478c77293560be6b04199b641fa467a2cc2b",
      "file": "publication-source-manifest.json",
      "runtimeSha256": "ba1b822d45e130579209f6da4fa11bdac775b0213c08ffb3af1838448207733f",
      "sha256": "<raw-source-manifest-sha256>",
      "size": "<raw-source-manifest-size>"
    },
    "tree": "<release-tree>"
  },
  "tag": {
    "commit": "<release-commit>",
    "name": "sdk-v<version>",
    "objectId": "<annotated-tag-object-id>",
    "ref": "refs/tags/sdk-v<version>",
    "tree": "<release-tree>"
  },
  "toolchain": {
    "corepackTreeSha256": "469b918857ea32351ac6a0737597abc90330dd521005687543dbd6b142536b08",
    "corepackVersion": "0.35.0",
    "nodePath": "/opt/hostedtoolcache/node/24.18.1/x64/bin/node",
    "nodeSha256": "f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a",
    "nodeSize": 123656816,
    "nodeVersion": "v24.18.1",
    "npmEntrypointSha256": "8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7",
    "npmIntegrity": "sha512-Iy5vXZ55m8tIaSCz6bqQf9+W5XbPfoyURsgWLjOkFglqHTep6RDZqRj2sfYGeRyZvGu2HuJWm0lux0rxPQ29lQ==",
    "npmTarball": "https://registry.npmjs.org/npm/-/npm-11.5.1.tgz",
    "npmTreeSha256": "dbe97072240cb2048f84faade50f938bdca3ba04efa67719259f5528397f0f09",
    "npmVersion": "11.5.1",
    "packCommand": "sanitize package manifests; node <authenticated-corepack> pnpm@10.34.0 --config.pnpmfile=/dev/null --config.global-pnpmfile=/dev/null pack",
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

The frozen Chat production source
`0da8c4749f57e63601b29d66032f80c9bbac1cb5` is selected by merged
Chat #248 producer `e35d4482ee1e2062bd5f6e7896dcb4ef5680dcb9`, pinning executable
harness `0a2cf1c9815b511bcc53e37360b5b2bafdfe20dd` and merged Cave
OpenCoven/coven-cave#5378 at
`cb3d22d1f403dd3b94b02668a599a2bf94999e8b`. Pre-merge Chat CI run
`34721888738` passed all ten checks at head
`56431f80e555476a54e6ac805db5f2e2bfb3a8a2`. The actual merge retains
that tested tree; this CI run is not protected evidence for the merged producer. The producer gives only
`cave_launch` a 40-second RPC response budget around the native 30-second
readiness deadline; all other RPCs retain their 10-second bound. Both harness clients use this budget; generic service
errors remain unknown, not timeout evidence. The merge retains the immutable harness source ancestry.

The bound quota diagnostic distinguishes a readable follow-up from a missing
file or directory. Every outcome preserves the initial quota failure and rejects
the measurement. Persistent means another nonmissing exception, which need not
match the first. Production Windows root alignment remains required.

The native regression proves SYSTEM or Administrators ownership using the
isolated process token profile before testing the discovery reader. Unknown
ACL metadata for a trusted profile owner remains unavailable and rejected. Follow-up observations do not
capture the original read and never authorize launch. Existing discovery
trust, quota, assertion and dependency policies remain unchanged. This is a
diagnostic-only rebind; native protected validation and release acceptance
remain outstanding.

The Windows reader retains the validated isolated token for synchronous quota
scans, including terminal accounting after account disablement. Private ACLs
and existing quota bounds remain enforced. The Coven daemon/observation source
is merged #1015 at `8c3735f374d6bc95e5b6fd107f7e7308fa26a2f8`.
SDK landing, both validator-scope rotations and fresh protected validation
remain required release gates.

Protected run `34667436672` used Chat `f77b249` and SDK `5730979`.
Linux and Darwin records independently passed archive digests, scans, exact
identities, Cave timing and all 197 ordered assertions. Windows reached the
Cave authority command and reported `phase1.cave-authority.startup`; validation,
attestation and aggregation were skipped. This identifies a startup/readiness
family, not a record identity, timing or assertion mismatch. The earlier quota
denial in `34666399779` remains a separate observation.

Protected quota-depth run `34670074847` used Chat #229 and SDK #212.
Linux and Darwin again passed independent record verification with all 197
ordered assertions each. Windows failed closed with `access-denied`, root
`bootstrap-aggregate`, operation `directory-enumeration-depth-3-plus`. This
identifies a capped descendant depth in the bootstrap tree; it does not
establish a Cave record identity, timing or assertion mismatch. Validation,
attestation and aggregation were skipped. This remains separate from the
Cave startup observation.

Protected run `34672157833` used Chat #230 and SDK #213. Linux and
Darwin independently passed archive digests, scans, exact record identities,
Cave timing and all 197 ordered assertions each. Windows failed closed with
`access-denied`, root `harness-cargo-registry`, operation
`directory-enumeration-depth-3-plus`. Validation, attestation and aggregation
were skipped. This is distinct from the earlier bootstrap quota denial and
Cave startup observation; it establishes no Cave identity, timing or assertion
mismatch. The new scope/repeat fields require fresh protected evidence before
any transience or persistence claim. Both validator scopes must select the
verified SDK merge before that run. No passing aggregate or completed release
acceptance is claimed here.
Protected run `34675842331` used Chat #231 and SDK #214. Linux and
Darwin independently passed archive digests, scans, exact record identities,
Cave timing and all 197 ordered assertions each. Windows reached the Cave
authority, but discovery publication failed with the fixed subtype
`phase1.cave-authority.startup.discovery.missing`. The listener remained
healthy because publication errors are intentionally degraded. The root cause
was a redundant `SetOwner` call that requires `WRITE_OWNER`, which the
protected standard user intentionally lacks. Validation, attestation and
aggregation were skipped. The Cave and Chat repairs require this newly bound
SDK validator and a fresh protected matrix before any passing aggregate or
completed release acceptance is claimed.

Protected run `34687009654` used merged Chat #233 and SDK #216. The frozen
supervisor build passed, Linux and Darwin passed all conformance checks, and
Windows progressed through restricted Cave startup and discovery before
failing at `phase1.cave-authority.assertion.takeover`. That focused proof alone
allocated its scratch fixture beneath the restricted repository checkout,
bypassing the canonical Cave temp root. Cave #5378 now allocates the takeover
fixture through the existing conformance temp helper, setting and restoring
`TEMP`, `TMP`, and `TMPDIR` in cross-platform tests while preserving authority
assertions, cleanup, quotas, bounded diagnostics, and fail-closed behavior.
Chat #235 binds the merged Cave repair without changing the frozen workflow,
bootstrap, Unix preparation, native-test, package, toolchain, runner, or
artifact bytes. This SDK validator and both protected scopes must rotate before
fresh protected acceptance.

Chat #219 and the final protected acceptance gate remain open.

Chat #203 repaired packaged provenance checks that incorrectly required
ancestry between independently frozen Chat/SDK authorities. Exact revision,
tree, clean-checkout, file digest and native-delta checks remain. GLib adoption
landed through #210 at `9f073f05241c2d3241b23ed9d73b26c6cd55ce7e`;
native run `34498480972` validated those GLib trees. That earlier evidence does
not validate the combined staging harness. The workflow, both Windows
bootstraps and trusted Unix preparation hashes and fixtures are refreshed for
the integration, including the producer module that retains staging bindings. After
verified Chat landing, merge the final validator binding, rotate both scopes
and obtain fresh protected acceptance. Chat #188 remains open for protected
acceptance and advisory reconciliation; #206 retains the Windows quarantine
issue. Ordinary CI does not replace fresh protected validation.

Both the schema-v1 and schema-v2 harnesses preserve the resolved Rust
toolchain ahead of the supervisor PATH, without inheriting Cargo credentials
or a global Rust default.
Schema-v2 also preserves the built Chat RPC executable outside its Cargo
target and removes that target before the Coven build. It now preserves the
built Coven executable the same way and removes the Coven target before the
shared observation target starts. Residual observation failures expose only
fixed SDK/Chat install, test, Rust-test, or cleanup substages; Windows disk,
silent exit, and native process failures remain bounded to path-free
diagnostics.
Its protected workflow requires
an exact SDK `validator_revision`, uses protected environment ID
`20863036831`, validates the three static platform artifacts in
`validate-conformance-artifacts`, and delegates OIDC provenance issuance only
to `attest-conformance-artifacts`. The validator checkout is pinned by the
protected `CLIENT_V1_CONFORMANCE_VALIDATOR_REVISION` environment variable.
Unix production receives a reviewed tool path containing only exact Git/system
directories plus canonical regular-file `node`, `pnpm`, and `rustup` inputs.
The supervisor validates and copies pnpm's complete package runtime into its
root-owned trusted directory, installs a fixed wrapper through the trusted
Node copy, and copies `rustup` under the `rustup`, `cargo`, and `rustc`
multicall names.
The governed harness invokes trusted `pnpm` directly; Corepack and private
runner-home directories are absent from restricted execution. Windows
bootstrap and schema-v2 commands launch pinned npm/pnpm JavaScript entrypoints
through Node without relying on a PATH shim. The bootstrap reads the explicit
child `Process.ExitCode`; Unix supervision preserves a bounded exit-status diagnostic.
That environment must disable administrator bypass, require reviewer user ID
`68980965`, permit self-review, have a zero-minute wait timer, and allow
protected branches only. Its `required_reviewers` rule therefore has
`prevent_self_review: false`; this is the authorized exception for the
dispatcher and sole reviewer account.
Aggregation and release readiness remain fail closed until all three protected
records and their reviewed GitHub attestations exist. That protected evidence
remains pending until this SDK validator merges and
`CLIENT_V1_CONFORMANCE_VALIDATOR_REVISION` is rotated to the merged revision,
as documented in
[`docs/workflows/client-v1-cross-repository-conformance.md`](docs/workflows/client-v1-cross-repository-conformance.md).

Before advancing this candidate after that blocker is resolved, copy the
canonical aggregate to
`docs/client-v1-cross-repository-results/1597835325cf3762b51408ff0a565037eeb25f64.json`,
and add the sibling reviewed evidence index
`docs/client-v1-cross-repository-results/1597835325cf3762b51408ff0a565037eeb25f64.index.json`.
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

`GH_TOKEN` is injected only into the exact `gh api`, `gh run download`, and
`gh attestation` subprocesses. Local Git inspection, the committed Cave
assertion engine, package builds, and package creation run with both
`GH_TOKEN` and `GITHUB_TOKEN` scrubbed.

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

Run the local exact-runtime release and security checks with:

```bash
corepack pnpm@10.34.0 verify:development-release-configuration
```

This validates the local workflow, release configuration, package policy, and
security invariants under exact Node `v24.18.1` without claiming that remote
evidence exists. It is intentionally not named or implemented as release
readiness. Candidate advancement uses the authoritative release-readiness path:

```bash
GH_TOKEN=... \
OPENCOVEN_GH_PATH="$(command -v gh)" \
corepack pnpm@10.34.0 verify:release
```

The authoritative command requires named evidence and the exact live
environment policies. The current aggregate value remains `null`, so
candidate advancement fails specifically for missing evidence. A configured
record must be a committed, clean regular file at the exact candidate path
with its committed sibling index. Release readiness revalidates the lock,
schema, registry, validator, candidate, and authoritative primary-record
bytes, then uses the exact clean frozen Cave checkout to re-render Cave
records. This does not open `publishingEnabled`, change package privacy,
create a tag, or authorize npm.

Before unlocking, create the dedicated `publication-candidate` environment,
the protected `npm-release` approval environment, and the final
`npm-publish` trusted-publisher environment. A referenced but missing
environment is not acceptable: GitHub would auto-create it without protection.
All three environments must use this exact protected-branch-only deployment
policy:

```json
{
  "deployment_branch_policy": {
    "custom_branch_policies": false,
    "protected_branches": true
  }
}
```

All three environments must report `can_admins_bypass: false`, a zero-minute
wait timer, exactly one `branch_policy` protection rule, and no custom
deployment-protection rule. `publication-candidate` and `npm-publish` have no
required reviewers and therefore no self-review gate. `npm-release` must keep
environment ID `20778492972`, contain exactly one `required_reviewers` rule
for immutable GitHub user ID `68980965`, and set `prevent_self_review: true`.
No custom branch or tag pattern, including `evil`, is permitted. The release
workflow itself remains dispatch-only and main-only, but those workflow checks
do not replace the live environment policy.

Run the authoritative read-only check with a token that can read the
repository and environments:

```bash
GH_TOKEN=... \
OPENCOVEN_GH_PATH="$(command -v gh)" \
corepack pnpm@10.34.0 verify:release-environments
```

The command fails if the repository identity, any environment, or any policy
field is missing or differs. Its canonical JSON output is the environment
policy receipt. Preserve that exact receipt in the #40 publication
authorization; release-time authorization re-fetches the live API state and
requires the IDs, timestamps, rules, and digest to match.

The verifier also compares the `npm-release`
environment rules' `updated_at` value observed while the deployment is
pending with the protected job's deployment `created_at`. A current
environment configuration or later deployment status cannot replace the
attested pending witness. Confirm branch protections and required checks,
confirm npm organization ownership, and complete the first-publish/trusted-
publisher prerequisites below. Until those remote rules are configured
exactly, publish mode intentionally fails closed.

The `npm-release` approval is consumed by the dedicated `approval-evidence`
job. The final `publish` job cannot start until that job and its isolated
attestation job succeed; its exact numeric job ID is discovered before the
approval receipt is written and is included in the attested handoff. The final
job uses `environment: npm-publish`, not `npm-release`: this gives npm an exact
OIDC environment binding without creating a second protected approval
deployment.

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
commit is on `main`. Record its annotated tag object ID in the immutable #40
authorization. The release workflow verifies that the tag ref still names
that exact tag object and that the tag peels to the authorized commit/tree.
It repeats this check after protected approval and immediately before the
first npm publish.

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
verify mode runs the dedicated `publication-candidate` producer. That job has
no `id-token: write`, receives no OIDC request variables, and cannot create a
GitHub attestation. A pinned
`actions/setup-node` installation is accepted only at the exact hosted-runner
path and exact Linux x64 executable SHA-256; the bundled Corepack 0.35.0
54-file tree is independently hashed before use. The job does not execute
repository pnpm hooks: install uses `--ignore-pnpmfile`, build/pack force
`pnpmfile=/dev/null`, inherited package-manager and Node hook configuration is
discarded, and the exact Corepack entrypoint from the authenticated Node
distribution is invoked by absolute path. The job clones the exact #38
candidate commit, verifies the frozen runtime manifest, applies only the
reviewed metadata transform, installs the frozen dependency lock with scripts
disabled, invokes the exact installed `tsup` 8.5.1 JS entrypoint under the
authenticated Node rather than a package-script or `.bin` shim, builds and
then deterministically removes publish lifecycle fields from the temporary
package manifests before invoking `pnpm pack`. It creates four tarballs,
rejects `private: true`, `publishConfig`, and any remaining publish lifecycle
scripts, and writes the schema-v6
publication manifest plus `publication-source-manifest.json`. Candidate
creation does not require SHIP. The dedicated `publication-candidate`
environment creates a deployment identity for the exact producer job. Its
frozen step graph uploads exactly
`opencoven-sdk-publication-<commit>-<version>` and exports only the official
upload action's immutable artifact ID and archive digest.

Only after that upload succeeds, `publication-candidate-attestation` starts
without a checkout. It has no shell, package manager, repository action,
local/composite/reusable action, or repository-controlled code path. Its exact
three pinned official steps download the candidate by artifact ID with digest
mismatch set to `error`, use `actions/attest` to hash and attest both manifests
and four tarballs, and upload the resulting `attestation.json` as
`opencoven-sdk-publication-attestation-<commit>-<version>`. #40 records the
producer and attestation numeric job IDs, candidate and bundle artifact IDs,
names, archive digests, raw bundle digest, exact run attempt, workflow commit,
source commit/tree, and producer environment/deployment. Verify mode never
publishes.

After #40 reviews those exact bytes and the exact attestation bundle, publish
mode must run again from the same
commit and tree. Start publish mode with the exact #40 comment ID, then wait
for both `approval-witness` and `approval-witness-attestation` to finish before
approving `approval-evidence`. The unprivileged witness records the exact run, attempt,
source, environment ID, rules digest/version, and immutable reviewer ID while
GitHub still reports a pending deployment; the checkout-free attestation job
downloads that exact artifact ID and attests only `pending-approval.json`.
The environment-protected, OIDC-free `approval-evidence` job verifies that
witness attestation, resolves #40 again, binds its own job/deployment and start
time plus the exact authorized tag object ID, and uploads
`protected-approval.json`. A second checkout-free
`approval-evidence-attestation` job attests only that uploaded receipt. The
final publish job requires both producer jobs and both isolated attestation
jobs and rejects current environment rules or later POSTed deployment statuses
as substitutes for those receipts.

Publication then verifies the successful candidate workflow run and exact
producer/attestation jobs, run attempt, numeric job/environment/deployment IDs,
candidate artifact ID/archive digest, and attestation-bundle artifact
ID/archive digest. It downloads both artifacts by reviewed ID, byte-verifies
the raw bundle, both manifests, and every tarball, and cryptographically
verifies all six candidate subjects with that exact bundle plus both approval
attestations against their exact run attempts. It never rebuilds or repacks. A
gzip header, compression level, filename, size, digest, workflow run, producer
or attestation job, deployment, environment, rules version, artifact, bundle,
commit, tree, source-manifest, or sterile publisher change requires new
evidence and, where candidate bytes change, a new #40 review.
After all protected approval evidence is validated, the publisher re-fetches
the tag ref and annotated tag object, rechecks the local peeled commit/tree and
the main workflow provenance, and performs the same check immediately before
the first npm publish. A moved, replaced, lightweight, or differently peeled
tag fails closed without invoking npm.

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

For each package, configure npm's GitHub Actions trusted publisher with these
exact values:

- organization/user: `OpenCoven`;
- repository: `sdk`;
- workflow filename: `release.yml`;
- environment: `npm-publish`.

Do not register any trusted publisher until
`corepack pnpm@10.34.0 verify:release-environments` succeeds and its exact
environment policy receipt is embedded in the immutable #40 authorization.
The setup process fails closed when an environment is missing, auto-created
without protection, allows custom branches, permits administrator bypass, has
the wrong reviewer or self-review setting, has a nonzero wait timer, or exposes
an unexpected protection rule.

npm does not expose a trusted-publisher job-name field. The frozen workflow
validator therefore requires `publish` to be the only `npm-publish` job and
the only OIDC-bearing job that may check out or execute repository-controlled
code or authenticated npm. The other three OIDC-bearing jobs are
checkout-free, shell-free, exact pinned official-action attesters. Do not
configure npm with the protected `npm-release` approval environment: that
environment belongs only to the OIDC-free approval producer. Confirm all four
packages:

- `@opencoven/sdk-core`
- `@opencoven/cave-client`
- `@opencoven/coven-client`
- `@opencoven/sdk`

## 8. Normal OIDC publication

After bootstrap, normal releases use workflow mode `publish`. The frozen graph
first completes #40 resolution, protected `npm-release` approval evidence, and
both isolated approval-attestation jobs without npm-publishing OIDC available
to repository-controlled code. Only then may the final `publish` job enter
`npm-publish`, download the two approval artifacts plus the reviewed candidate
and candidate-attestation bundle by exact artifact IDs, verify all bytes and
attestations, and invoke the digest-bound sterile publisher. No repository
dependency installation, rebuild, or repack occurs in the publish job.

The publisher does not use npm from the repository checkout or obtain it
through pnpm. It downloads only
`https://registry.npmjs.org/npm/-/npm-11.5.1.tgz` with the pinned SHA-512
integrity, safely extracts it after byte verification, rejects links and an
unexpected file list, and verifies the complete 2,293-file CLI tree and
`bin/npm-cli.js` SHA-256 before use. A fake CLI that reports `11.5.1` is not
sufficient.

The sterile publisher rejects `NPM_TOKEN` and `NODE_AUTH_TOKEN` and discards
inherited PATH entries, `GITHUB_PATH`, `GITHUB_ENV`, Node require/import hooks,
shell init, npm/pnpm config, proxy, certificate override, lifecycle, and
unrelated GitHub-token inputs. Each tarball is copied byte-for-byte into an
owner-private temporary directory outside the checkout. npm runs there with
generated private user/global configs and cache, registry pinned by config and
CLI to `https://registry.npmjs.org/`, strict certificate validation, no auth
token or `always-auth`, and `--ignore-scripts`. npm version and resolved config
checks run without OIDC variables. Only each final authenticated `npm publish`
subprocess receives GitHub's two short-lived OIDC request variables, a fixed
non-secret `GITHUB_ACTIONS=true` provider marker, and the validated
repository/workflow/ref/commit/run/hosted-runner fields required for npm
provenance.

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

1. suspend both `npm-release` and `npm-publish`, remove the npm trusted
   publisher bindings, and stop active workflows;
2. revoke bootstrap credentials, npm sessions, and any affected identities;
3. preserve workflow logs, manifests, attestations, audit events, and package
   bytes as evidence;
4. assess installed-package impact and publish an advisory when appropriate;
5. deprecate affected versions and issue a corrective release;
6. complete a blameless postmortem before restoring publication.

Security disclosure follows [SECURITY.md](SECURITY.md).

Protected run `34406621503` passed Linux and macOS, but Windows failed at
`phase1.runtime-observations.coven-rust-tests.failed` after SDK, Chat, and
Chat Rust observations. Validation, attestation, and aggregation were skipped.
The successor preserves every selected test and existing limit while
reporting a bounded category for each of the five selected Windows Coven
observation commands. It distinguishes command failures, an exact test failure,
and a successful command missing the expected test; raw output stays private.
The new diagnostics require a complete protected attempt after final binding.
