# Release process

The repository contains release-readiness automation, but this phase does not publish packages.
It does not create npm package records, configure GitHub
environments, or register trusted publishers. The four-package 0.0.1 release
group and the private CLI workspace all remain private, and the repository
publication lock remains closed.

`@opencoven/dev-cli` is not part of the 0.0.1 release group. Release tooling must
not pack, publish, attest, or configure a trusted publisher for it.

## Current conformance evidence state (2026-09-25)

`release.config.json` `conformanceEvidence.aggregateRecord` names the first
accepted SDK #38 aggregate, [`96804bc483a063e41e9a9738a4ace61970f6c0a4.json`](docs/client-v1-cross-repository-results/96804bc483a063e41e9a9738a4ace61970f6c0a4.json),
for frozen candidate `96804bc483a063e41e9a9738a4ace61970f6c0a4`. Dated
checkpoints below that say `aggregateRecord` remains `null` or unset, or that
no passing aggregate exists, describe the state at their own dates.
`publishingEnabled` remains `false`, all packages remain private, and the #40
disposition in
[`docs/workflows/first-release-security-review.md`](docs/workflows/first-release-security-review.md)
still governs. An aggregate is evidence, not SHIP.

## v0.0.1 preparation decision (2026-09-12)

The intended first public release is now **v0.0.1**, replacing the earlier
0.1.0 target without changing the four-package scope:
`@opencoven/sdk-core`, `@opencoven/cave-client`, `@opencoven/coven-client`,
and `@opencoven/sdk`. The private CLI remains excluded. References to 0.1
in the existing delivery program describe the original scope and evidence,
not authorization to publish either version.

The source preparation now adopts 0.0.1 in all four package manifests and
initial changelogs and freezes that private candidate's exact source and
tarball identities. This is not accepted #38 evidence or a #40 SHIP disposition.
`publishingEnabled` remains `false`, all packages remain private, and
`conformanceEvidence.aggregateRecord` remains unset. The private CLI retains
its independent 0.1.0 version while consuming exact 0.0.1 workspace dependencies.

### Second candidate source preparation (2026-09-25)

The [#40 re-review](docs/workflows/first-release-security-review.md#candidate-re-review-2026-09-25)
blocks candidate `96804bc4`, which predates the High-severity Cave fixes #277
and #285 and the single-use timeout fix #294. The release owner has directed
a replacement private **0.0.1** candidate cut from reviewed main
`82fcd56de1abfec82eb581190dab6e90a7218a5a`.

The applicable Cave, Coven and SDK Changesets merged since `96804bc4` are
folded into each package's existing unpublished `0.0.1` changelog and consumed.
#285 carried no Changeset; its entry is written directly. Several folded
Changesets were `minor`; folding them into the initial release is not an
instruction to run automatic versioning, and no `0.0.2` or `0.1.0` release is
created. As in the first preparation, the session-policy Changeset, the private
CLI patch and the empty maintenance Changeset remain unchanged. No runtime
code, package version, dependency pin, conformance lock or privacy flag
changes here.

Do not capture the replacement candidate from this pre-merge head. After the
reviewed merge, pack that exact commit twice with the local-verification
tooling and record its real source and package identities. Adopting those
identities in Chat, rebinding the conformance lock, fresh protected evidence
and a new #40 disposition follow separately. `96804bc4` remains the bound
candidate until then.

### Fresh candidate source preparation (2026-09-14)

*Historical: the first candidate's preparation, superseded by the
[second preparation](#second-candidate-source-preparation-2026-09-25) above.*

The release owner has selected a fresh private **0.0.1** candidate that
includes the Coven Automations capability-discovery APIs merged in #251.
Source preparation starts from reviewed main
`6a1c4b0a074e60f816ce4fcc98150e19c3438ea2`, preserving the later #252
diagnostic producer binding and all other merged work. This metadata update
does not change runtime code, package versions, dependency pins, or privacy.

The applicable `automations-capability-read.md` Changeset is incorporated
into the Coven client's existing unpublished `0.0.1` changelog and consumed.
Its actual classification was `minor`, not `patch`; folding it into the
initial release is not an instruction to run automatic versioning. Do not
create a `0.0.2` or `0.1.0` release for this preparation. The unrelated
session-policy feature, private CLI patch, and empty maintenance Changesets
remain unchanged.

The captured private candidate was
`96804bc483a063e41e9a9738a4ace61970f6c0a4`, tree
`aa9eb8e924735419a9afdbcc80a5b087504ccc9d`. Its canonical runtime manifest
and exact package bytes are frozen by the current release configuration and
conformance lock. Chat #270 adopted its private archives; Chat #272 corrected
the Cave release binding. Protected release acceptance remains incomplete; see
the [#293 binding checkpoint](#final-chat-293-binding-checkpoint) for delivery
and partial-record evidence. Later runtime
changes are not implicitly included in this immutable candidate. Candidate77's
manifests, tarballs, and partial records remain historical evidence for
candidate77. All #38/#40 acceptance and publication gates remain closed.

### Exact release-ref policy preparation

The release workflow and publication evidence validators support only
`refs/heads/main` and `refs/heads/release/sdk-v0.0.1`, with case-sensitive
matching. This is policy-code preparation, not authorization to create or
protect the release branch, dispatch a workflow, enable publication, or SHIP.
It does not change candidate968, adopt later APIs from main, or create new
accepted conformance evidence.

The workflow commit W must still equal the release source R: checkout HEAD,
`GITHUB_SHA`, `GITHUB_WORKFLOW_SHA`, manifest source, tag target and attestation
source/signer digests all bind that same reviewed R. There is no independent
release-commit input. Workflow refs, run branches, deployment refs and
attestation certificate refs must agree exactly; the two allowed refs cannot
be substituted for each other even when they point at the same commit.

Before final #38 acceptance, these governed controls must land in the reviewed
validator V, including the ref-policy helper in its runtime-file inventory.
The eventual R must genuinely descend V, and V must descend candidate968 C.
R's governed controls must be byte-equal to V, while R's normalized public
runtime must equal C. V need not have C's public runtime. Creating a branch
at C and copying V's files does not satisfy this ancestry requirement.

A separately authorized, reviewed release-line change must preserve C's
public scope only on that line, without reverting main or silently including
its later APIs. Effective release-branch protection, unchanged policies for
all three environments, publication enablement, final artifact review and
immutable #40 SHIP authorization remain operational prerequisites.
For normal OIDC publication (section 8), `npm-release` still prevents
self-review: its sole required reviewer needs a distinct authorized dispatcher.
That workflow requirement is not an inferred prerequisite for the separate,
manually approved first-publish bootstrap (section 6). This preparation creates
neither identity nor permissions, and leaves all packages private and
`publishingEnabled: false`. `aggregateRecord` names the accepted SDK #38
aggregate for the frozen candidate; it does not enable publication.

### Compatibility prerequisite

The prerequisite landed in
[OpenCoven/coven-cave#5376](https://github.com/OpenCoven/coven-cave/pull/5376)
at `e806655a7100e9d589662a6f3817c3fd8cde48ad`. The actual authority fixture
was imported through `sync:contracts`, with SHA-256
`0c03baea9c21f0985df41eef3c5ae5223497b9081c665b53ddecab36598f5ede`.
Provenance and verifier pins bind that exact commit and those bytes.
Its `minimumClientVersion: "0.0.1"` accepts both 0.0.1 and existing 0.1.0
clients, but not 0.0.0 or 0.0.1 prereleases.

`packages/cave/src/version.ts` still derives `CAVE_CLIENT_VERSION` from the
package manifest. Health negotiation, pairing, and canonical reads retain
strict comparisons with no fabricated version or bypass. Additive authority,
operation, discovery-v2, and cursor fixture metadata require no public API
shape change. The runtime error allowlist includes the authority's
`ownership_refused` code so valid refusals are not converted to
`invalid_response`. The original HPKE vectors retain their 0.1.0 crypto inputs;
the Coven daemon fixtures are byte-for-byte unchanged.

Any changed source or fixture requires fresh candidate identity and conformance
evidence under the existing release rules. Do not use the old source freeze to
claim verification of this preparation.
`conformance/client-v1-cross-repository-lock.json` now binds the new 0.0.1
candidate `96804bc483a063e41e9a9738a4ace61970f6c0a4`, tree
`aa9eb8e924735419a9afdbcc80a5b087504ccc9d`, including its 18,280-byte Cave
fixture. Package fixture provenance remains the reviewed
`e806655a7100e9d589662a6f3817c3fd8cde48ad`; production Cave authority is
separately pinned to `ecdcdcf8a75b62bb912ec48215ae20ab0809a181`.
The historical 0.1.0 candidate
`1597835325cf3762b51408ff0a565037eeb25f64`, its 12,308-byte fixture, tarballs,
and prior evidence remain historical inputs, not relabeled 0.0.1 evidence.
This source binding does not accept #38 evidence or authorize #40 SHIP.

### Ordered preparation checklist

- [x] Coordinate and review the Cave authority's minimum-client contract for
  0.0.1, including health, pairing, and canonical reads.
- [x] Once that contract is available, prepare all four SDK manifests and
  changelogs at 0.0.1 together. Update exact internal workspace dependencies,
  including private CLI and example consumers, and regenerate the lockfile.
  Keep the CLI's own version independent and its manifest private.
- [x] Reconcile pending Changesets into the initial-release changelogs.
  The managed-native and browser-safe content of `quiet-caves-stay.md` is
  included in the initial core/Cave changelogs and that patch request is
  consumed. Do not run `release:version` to prepare this release: no 0.0.2
  increment is intended.
- [x] Validate the rebuilt 0.0.1 packed packages and examples locally against the
  reviewed contract, including rejection of genuinely incompatible versions.
  Retain the existing Node support policy and release safeguards. These local
  checks are not committed-candidate or cross-platform release evidence.
- [x] Freeze the new 0.0.1 candidate and bind its actual package bytes to the
  reviewed Chat consumer and merged producer.
- [ ] Obtain complete #38 evidence for
  `darwin-arm64`, `linux-x64`, and `win32-x64`. Preserve the existing 0.1.0
  evidence as historical input; do not relabel its tarballs or hashes.
  Commit the accepted aggregate and its index, and bind them in release
  configuration using the documented evidence workflow.
- [ ] Prepare the reviewed release-enablement changes and verify the live
  GitHub environment and npm trusted-publisher prerequisites. Produce and
  attest the exact 0.0.1 publication candidate from the release commit.
- [ ] Obtain #40 SHIP authorization for those exact bytes and the annotated
  `sdk-v0.0.1` tag object, then complete the protected approval and #41
  publication/provenance sequence described below.

Until these prerequisites are satisfied, 0.0.1 is a blocked release target,
not a publishable artifact. This preparation does not create a tag, GitHub
release, npm package, deployment approval, or publication authorization.

### Gate investigation checkpoint (2026-09-12)

At this checkpoint the Cave-owned minimum-client prerequisite was proposed in
[OpenCoven/coven-cave#5376](https://github.com/OpenCoven/coven-cave/pull/5376),
head `bc5c5caf6938f2273bca609b5610dc78f9febdb0`. It lowers the advertised
floor for the existing implementation and regenerates the authority fixture.
At that checkpoint SDK adoption was pending reviewed landing. The later
protected merge at `e806655a7100e9d589662a6f3817c3fd8cde48ad` and source
adoption above completed the compatibility prerequisite, but did not at that
time freeze the current candidate or satisfy the release-evidence gates.

Protected [OpenCoven/chat run 34681042400](https://github.com/OpenCoven/chat/actions/runs/34681042400)
used producer `8e33e2a78c0ef639e88466de21d8580604bd28f0` and SDK validator
`e8122a9ea63a9ca1b354a2730d77e627cffe87c3`. Darwin and Linux jobs succeeded,
but Windows job `103519812121` failed with
`phase1.cave-authority.startup.discovery.missing`. Validation, attestation,
and aggregation were skipped. This result follows the Cave discovery ACL
repair bound by #215; that repair has not established complete protected
acceptance. Both validator scopes already select the expected SDK revision.
These jobs concern the historical 0.1.0 candidate, not the frozen 0.0.1 release.

The live release-environment policy verifier accepted all three environments
at this checkpoint. That observation is not an approval and must be repeated
for the final candidate. Preliminary SDK security review established no new
high-confidence vulnerability within its reviewed scope, but did not clear
the pending Cave compatibility change, native evidence, or future 0.0.1
artifacts. #40 remains BLOCK until the complete final-candidate review and
authorized immutable SHIP record exist.

### Release gate checkpoint (2026-09-14)

**0.0.1 remains blocked.** The private conformance candidate is frozen, but
there is no accepted three-platform aggregate, final publication candidate,
or SHIP authorization. GitHub issue state alone is not release evidence.
At this checkpoint #38 was marked closed even though its latest
[evidence disposition](https://github.com/OpenCoven/sdk/issues/38#issuecomment-5659174495)
explicitly withheld acceptance. Do not advance #40, #41, or #31 on that closure.

The reviewed source binding is SDK #246,
`ff96d08e19e534e982b3e9ea24fb9cc7e9e22a67`, with Chat producer
`7ec15b20b5526ef809c8f237a4dab1f640cb8a4d`, Cave authority
`8a06421a705c2d7891c3f44cc580c569f6cbe2c1`, and unchanged private SDK
candidate `77d825d17809cfec2fad4acb9b1526b3c4752f9d`.

Protected [run `34796638173`, attempt 1](https://github.com/OpenCoven/chat/actions/runs/34796638173/attempts/1)
has authenticated partial `darwin-arm64` and `linux-x64` records, each with
197 ordered passing assertions. Windows failed at
`phase1.native-scenarios.launch.discovery-not-found`, followed by profile
cleanup failures. No Windows record exists for that attempt; downstream
validation, attestation, and aggregation were skipped. The expected Windows
record has 196 assertions, not 197.

[Attempt 2](https://github.com/OpenCoven/chat/actions/runs/34796638173/attempts/2)
also failed Windows, this time at the fail-closed quota monitor with
`access-denied; root=cave-checkout; scope=none; operation=directory-enumeration-depth-3-plus; repeat=missing`,
followed by profile cleanup failures. That classification does not establish
resource exhaustion or authorize larger quotas. Do not combine records from
different attempts or treat an unexamined retry as authenticated evidence.

[Chat #266](https://github.com/OpenCoven/chat/pull/266) proposes bounded
publication-refusal and profile-survival diagnostics. At this checkpoint it
is an active diagnostic follow-up, not a proven native repair. Preserve its
owner's work and the existing trust, cleanup, quota, and deadline controls.

The authoritative environment-policy verifier accepted `publication-candidate`,
`npm-release`, and `npm-publish` at `2026-09-14T05:12:12.939Z`, with policy
digest `90e1ef003ffa5bf45ef494a0ebe164bdc6af41ce0a58da5219b1949bc7f1c990`.
This read-only observation is not deployment approval or SHIP authorization.
Repeat it for the final publication candidate; do not reuse it as a future
policy receipt.

Continue through these gates in order:

1. Resolve the actual Windows failures through reviewed source changes.
   Bind the actual merged producer in the SDK validator, then obtain
   authorization for the exact protected run and deployment. Re-read both
   validator scopes before dispatch and approval; an intervening rotation
   invalidates a waiting run's assumptions.
2. Authenticate all platform records and the complete successful run,
   including validation, attestations, and aggregation. Commit the accepted
   aggregate and reviewed index and select them in
   `conformanceEvidence.aggregateRecord`. A private candidate's four tarballs
   are conformance inputs only, never npm publication inputs.
3. Prepare the reviewed release-enablement changes. Obtain fresh explicit
   authorization before enabling publication or creating the annotated tag.
   Generate the exact attested publication candidate, repeat the live
   environment-policy verification, and obtain the immutable #40 SHIP
   authorization described below for those bytes and the tag object.
4. Obtain fresh explicit authorization for any npm bootstrap,
   trusted-publisher setup, and publication in #41. Complete protected
   approval and registry byte/provenance verification before closing #41
   and #31.

`publishingEnabled` remains `false`, all five workspace packages remain
private, and `conformanceEvidence.aggregateRecord` remains `null`. The CLI
is still excluded. This checkpoint authorizes no remote mutation and
relabels no historical artifact.

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

Publication artifacts use schema version 7 from
[`conformance/release-artifact-manifest.schema.json`](conformance/release-artifact-manifest.schema.json).
The exact release commit produces these bytes before SHIP authorization. The
manifest carries its commit/tree, the reviewed repository `.npmrc` digest, the
conformance candidate commit/tree and canonical publication-source manifest,
the Node/pnpm/npm pack toolchain, the sterile publisher's exact runtime path,
size, and SHA-256, the exact workflow commit/ref/run attempt/job/environment,
the unique commit-derived artifact name, and every tarball filename, size,
and both SHA-256 and SHA-512. SHA-512 is computed from the same actual
publication tarball bytes, not from the private conformance archives. The
manifest contains no security-review claim. Earlier publication schema 6 and
authorization schema 8 are not accepted or relabeled as new evidence;
conformance schema 1 and candidate968 remain unchanged.

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
Authorization schema 9 additionally requires four ordered `npmProvenance`
entries. Each binds the exact package, npm PURL, tarball SHA-512, a separate
immutable artifact ID/name/archive digest, and raw bundle size/SHA-256. These
IDs must be distinct from one another and from the candidate and original
six-subject bundle artifacts. All four uploads belong to the same frozen
attester job and exact candidate run attempt; each name must be unique in that
run.
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
  "npmProvenance": [
    {
      "bundle": {
        "artifactDigest": "sha256:<actual artifact archive digest>",
        "artifactId": "<actual npm provenance artifact id>",
        "artifactName": "opencoven-sdk-npm-provenance-0-<release-commit>-<version>",
        "file": "attestation.json",
        "sha256": "<actual raw bundle sha256>",
        "size": "<actual raw bundle size>"
      },
      "packageName": "@opencoven/sdk-core",
      "sha512": "<actual publication tarball sha512>",
      "subjectName": "pkg:npm/%40opencoven/sdk-core@<version>"
    },
    "<corresponding index 1 cave-client entry>",
    "<corresponding index 2 coven-client entry>",
    "<corresponding index 3 sdk entry>"
  ],
  "packages": [
    "<the four exact ordered filename/size/SHA-256/SHA-512 entries>"
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
  "schemaVersion": 9,
  "source": {
    "commit": "<release-commit>",
    "repository": "OpenCoven/sdk",
    "runtimeManifest": {
      "candidateCommit": "96804bc483a063e41e9a9738a4ace61970f6c0a4",
      "candidateTree": "aa9eb8e924735419a9afdbcc80a5b087504ccc9d",
      "file": "publication-source-manifest.json",
      "runtimeSha256": "8c46276b5698d32d570ad4a89998b412cb0efde5641313b0c71ae41519e64ae7",
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

For 0.0.1, `release.config.json` also freezes the native Chat/real-authority
conformance matrix to `darwin-arm64`, `linux-x64`, and `win32-x64`. That
release-gate matrix is narrower than the published package Node runtime
support and does not by itself authorize release; #38 still requires one
passing evidence record for each target.

The frozen Chat consumer is
`ef8c747f1dbae0fd2bc9fcb24d3a0914f9f1cc49`, tree
`ffd1963ef9539c7a679909200175fb11a9305c95`, with all four committed vendor
archives byte-identical to candidate 96804bc. This binding selects the merged [Chat #375](https://github.com/OpenCoven/chat/pull/375)
producer `b10910545b14133a619e56641e5692a4335c83c4`, tree `7220622280415441646a3f6aef74113a98cc5bd2`.
Its reviewed head `27b41082d60f9acaaad2935e5a2b42005ee9e7fb` has the same complete tree
and has executable harness authority
`6a95b93d3eeb73a01f4a1882ea94ae9aa466345f`, tree `fd814b80ae2dd7bf59429672d9758be2f438085c`,
as its sole parent.
The merge parents are that harness authority and the reviewed head. The validator
checks the merge-to-reviewed-source edge, the source-to-harness edge, and complete
reviewed/delivery tree equality. The intermediate source-authority path is empty
again: this repin landed as a single commit.

This producer retains Chat #311's build-time home isolation, the exact Chat #314
producer-revision resolver, bounded Windows quota diagnostics, and Chat #327's
pinned-main freshness guard, Chat #348's shortened isolated Windows bootstrap
root, and the named report and Coven handshake diagnostics from Chat #361, #363
and #365. It adds Chat #370's two Windows repairs. First, the bootstrap selects
a whole reviewed profile per runner image, because GitHub's gradual rollout of
`20260922.246.2` serves it alongside `20260907.229.1` and the two differ in OS
build, PowerShell and .NET as well as Visual Studio. Second, the Coven
same-user identity scenario accepts exit code 1 from the daemon on Windows only,
after the authenticated stop succeeds: `coven daemon stop` ends the verified
daemon there with `TerminateProcess(handle, 1)`, and requiring 0 had failed that
assertion at its `result` stage on every Windows run. It also adds Chat #374:
a Google Fonts download failure during the frozen Cave build, previously reported
as `compile.module-resolution`, now reports `compile.font-fetch`, and only that
failure retries the Cave build once.
All 25 governed files and ten production
deltas are bound to reviewed Git bytes. Token/profile ownership, native cleanup,
resource limits, and operator isolation remain required. The SDK candidate and
Chat consumer, Cave, and Coven revisions remain frozen.

Chat #297 classifies native installation lock, entry, read, write and persistence
failures with fixed conformance-only codes. Ordinary-build error behavior and
retryability remain unchanged. All 25 governed file identities and ten production
deltas are bound together; the checkout regression executes the selected
harness's labels. Workflow fixtures and bootstrap digests bind delivered bytes.
The Windows supervisor explicitly owns the verified profile hive and unloads
it after terminal quarantine, retaining token/profile ownership if unload fails.
Fresh child logons load their session profile explicitly. Cleanup requires both
hives absent within the existing bounded deadline, even when paths are absent.
The cleanup-grant production delta consumes the validated marker by handle
and prunes only its empty private directories under the owning identity.
Parent handles and original file identities guard each removal; siblings,
unrelated contents and replacements are preserved. Failed pruning cannot make
committed consumption retryable. The native build uses the authenticated
producer checkout; the original consumer pin does not supply this delta.
The restricted Windows test preserves the primary bounded category through
cleanup and reports a separate secondary category. Ordinary CI does not replace
fresh authenticated protected validation.
Each lifecycle probe gets a separate containment job and matching nonce/name
binding while retaining the same isolated user and profile. All three credential
and profile checks remain required, followed by terminal quarantine and verified
cleanup. Residual-open diagnostics derive fixed purpose/access labels and retain
scope; legacy role-only calls remain compatible. No native access masks, sharing,
privileges or limits change.

SDK [#316](https://github.com/OpenCoven/sdk/pull/316) delivered the preceding
Chat #371 binding; that binding is historical and is not the one recorded above.
Its protected runs [36033589858](https://github.com/OpenCoven/chat/actions/runs/36033589858)
and [36038079308](https://github.com/OpenCoven/chat/actions/runs/36038079308) belong
to it, and both completed every platform, validation, attestation and aggregation
job with success. Earlier bindings, SDK #302's Chat #328 binding at
`1c10e63a9ff87934397e8defc2d0b98f3932abe2` among them, are historical.

Protected [run 35566636457](https://github.com/OpenCoven/chat/actions/runs/35566636457)
is historical and belongs to the preceding Chat #328 binding,
not to the binding recorded above. Linux and macOS artifacts independently
passed exact run/job and validator identities, ZIP digests, canonical schema,
privacy/isolation checks, timing, and all 197 ordered assertions each (110 Cave,
46 SDK, 41 Chat). Windows failed at
`phase1.packaging.chat-native-build.build-script` and produced no platform
record. Validation, attestation, and aggregation were skipped. The earlier
[run 35500732205](https://github.com/OpenCoven/chat/actions/runs/35500732205)
failed at the same stage. That stage is now identified: the `aws-lc-sys` build
script, whose deepest relative include exceeded `MAX_PATH` beneath the previous
isolated bootstrap root, which Chat #348 shortens.

Earlier run `35146928092` used Chat #311 / SDK #293 and produced independently
verified Unix records with 197 assertions each. Its Windows checkout-quota
failure is separate from the historical native-build failure and from run
`35138402347`'s operator Cave-home isolation failure.

Historical run `35125287541` failed Windows execution-root cleanup before
isolation validation. Run `35111662551` failed Windows isolation; run
`35100084575` failed Windows secure-store preflight and deletion-purpose cleanup.
Keep these failures distinct. Resolving the Windows evidence-assembly failure
and obtaining a complete authenticated three-platform aggregate remain required.
Chat consumer, candidate, Cave and
Coven identities remain frozen.
The original Chat consumer and Coven pin remain frozen. Production Cave is
`ecdcdcf8a75b62bb912ec48215ae20ab0809a181`, tree
`1634a8eb0a391419bf28af4be0020cfd8c4df472`, release `0.4.2`.
Its engine is 153,390 bytes with SHA-256
`e2742e3041648082e1087313f005a6e9407e2b8d2180881c42e109257804ec7b`.

This is a source-only candidate binding, not accepted platform evidence.

Historical protected [run 34977202052](https://github.com/OpenCoven/chat/actions/runs/34977202052)
used Chat producer `047e8ad7f4a2ca5a9009217de3c3f5f32fd98ba6` and SDK #284
validator `e37b195c246d55a5929dc74f7e7d116b1fc6dfd0`. Both validator scopes
were read back at that SDK merge; the frozen workflow and supervisor artifact
were authenticated before environment approval. Linux and macOS passed;
their records independently passed exact identities, canonical schema, private
scans, Cave timing and all 197 ordered assertions each (110 Cave, 46 SDK, 41 Chat).
Windows failed at
`phase1.native-scenarios.native-preflight-installation-secure-store-unavailable`
and produced no record. Validation, attestation and aggregation were skipped.

That historical run exposed the native secure-store category without identifying
the failing installation operation. Chat #297 subsequently landed profile
ownership and cleanup repairs, bounded operation diagnostics, and a restricted
native installation roundtrip. Its ordinary CI passed. SDK #290 then landed
that binding and both validator scopes rotated for protected run `35111662551`,
which failed Windows isolation. SDK #38 acceptance remains open.

The historical protected run `34916510997` used
Chat #278 producer `39ca57341647d7b00c210103dfc844a9d170d2cd` and SDK #268
validator `7ed60f0cc6210e8c89d489d1bb5ddf42e1b13baa` with candidate `96804bc`.
Linux and Darwin records independently passed identity, timing, and all 197
ordered assertions. Windows failed before publishing a record at
`phase1.cave-authority.startup.discovery.missing.read.not-found.publication.root-owner-unverified`.
The frozen Cave diagnostic includes probe execution, timeout, and report-parsing
failures; it does not establish an incorrect owner. Profile cleanup separately
failed a child relative-open with `ntstatus=c0000022`. Validation, attestation,
and aggregation were skipped. No Windows record identity, timing, or assertion
mismatch is established because no Windows record exists.

The earlier [Cave source-only disposition](https://github.com/OpenCoven/sdk/issues/40#issuecomment-5671819613)
covers the 77-file `d655` to `5ee8545` upgrade. Chat #282 adopts the subsequent
Cave #5410 repair `ecdcdcf`, whose rc7 run `34896723149` passed all 17 jobs.
The five frozen Cave artifacts, engine, and version remain unchanged. This
binding updates source identities, assertion provenance, schema binding, and
CI/release authority checkouts together. Historical fixture/vector origin
`e806655` is not relabeled.
`release.config.json` retains the fixed candidate's normalized runtime digest;
SDK #265/#266 APIs on main are not recaptured into that candidate.

Chat #283 landed after PR run `34925158331` and recovered push run
`34925125894` attempt 2 passed. SDK #272 landed as
`129d4fde5cc72929cb7b18cb6a9170a20fd2d8f2` after full repository verification,
independent binding review, and all eight hosted checks passed. Its exact
reviewed tree and GitHub signature verified. Both protected validator scopes
were rotated to that actual merge and read back exactly.

The preceding SDK #269 protected run `34922030401` passed independently inspected Linux and Darwin
records, including identity, timing, and all 197 assertions. Windows failed at
`phase1.stage.schema-v2-production.failed` before publishing a record; cleanup
separately failed a child relative-open with `ntstatus=c0000022`. No Windows
record identity, timing, or assertion mismatch is established. Downstream
validation, attestation, and aggregation were skipped.

Previous protected run `34928011200`, attempt 1, used Chat #283 and SDK #272.
Supervisor job `104250094041` passed; artifact `10379899103` matched the run,
source, uploaded ZIP digest and single executable. The exact frozen workflow
was authenticated before platform approval. Linux job `104250523066` and macOS job `104250522950` passed. Each retained
record independently passed archive/run binding, canonical schema, private
scans, exact identities, Cave timing, and all 197 ordered assertions. Windows
job `104250523120` failed with
`phase1.stage.schema-v2-production.unclassified.error` and published no record.
This identifies an Error-class fallback; an approved producer diagnostic missing
from the outer allowlist can also produce it. It does not identify a failing
operation or a record identity, timing, or assertion mismatch. Cleanup separately reported child relative-open
`ntstatus=c0000022`. Validation, attestation, and aggregation were skipped;
complete protected acceptance remains absent.
No Windows repair is established. Candidate `96804bc` and its runtime digest remain
unchanged; later SDK APIs on main are not recaptured. `publishingEnabled` stays
`false`, `aggregateRecord` stays `null`, and the packages stay private.
Final artifacts, protected evidence, registry compatibility, and #40 SHIP remain
separate gates.

The historical diagnostic checkpoint from protected run `34763766701` used
the pre-adoption Chat producer
`311dda625b20aaa91c7bf2b19718387ec56acab0` with SDK validator
`56fcf68e819c7f73201989e3c0f77fc2d17c0112`. Linux and Darwin passed; Windows
failed at `phase1.native-scenarios.launch.discovery-not-found`. Artifact
validation, attestations, and aggregation were skipped, so no aggregate
exists. The run is pre-adoption evidence and does not establish protected
success or a root-cause repair. Fresh protected evidence is required.

Protected run `34773356378` later failed closed on Windows with
`access-denied`, root `cave-checkout`, operation
`directory-enumeration-depth-3-plus`, and `repeat=readable`. Chat #263 repairs
only that classified case by accepting one fresh, complete, bounded retry
under the same validated isolated identity after an initial access denial.
Partial, missing, persistently denied, metadata, and file-length outcomes
remain terminal. Full ordinary Chat CI run `34779648793` passed, including the
native Windows supervisor regression, but is not protected conformance
evidence. The SDK validator must merge and both protected validator scopes
must rotate before a fresh protected run can satisfy platform, artifact,
attestation, and aggregation gates.

Protected run `34782181876` then proved that the quota repair cleared the
previous blocker: Linux and Darwin passed, while Windows reached native launch
and failed closed at `phase1.native-scenarios.launch.discovery-not-found`.
The protected supervisor's real-profile `.coven` DACL contains a read-only
`OWNER RIGHTS` (`S-1-3-4`) ACE. Cave treated that special SID as a foreign
principal and attempted a DACL rewrite, but the ACE intentionally suppresses
the owner's implicit `WRITE_DAC`; Cave therefore withheld discovery.
OpenCoven/coven-cave#5388 admits `OWNER RIGHTS` only when it is an `Allow` ACE
with no writable rights. Writable owner-rights entries, foreign writers, deny
entries, inherited DACLs, malformed reports, and unreadable DACLs remain
refused. Chat #264 binds that Cave merge without changing the supervisor ACL,
quotas, isolation, waiver policy, publication checks, or deadlines.

The adopted Cave authority retains bounded, source-attributed discovery
read/publication diagnostics and adds the narrow read-only `OWNER RIGHTS`
compatibility without forwarding raw errors or changing authority gates. The
frozen Chat production decoder and signed harness decoder are unchanged.
Independent merged-producer, source-head, executable-harness, production,
candidate, Cave, and Coven comparisons remain fail closed. These repairs
required a newly bound protected run to determine whether the publisher could
produce a Windows record and allow validation, attestation, and aggregation.
Their ordinary CI did not establish those outcomes; later evidence is recorded
in the final binding checkpoint below.
Live evidence verification fetches the merged producer, source head, every
bounded source-authority-path commit, and harness Git commit objects plus the
merged producer's `phase1-conformance.lock.json`; it rejects commit-graph,
tree, revision, release-manifest, tarball, consumer-lock, Cave, or Coven drift
before examining the protected run.

Both harness clients give `cave_launch` a 40-second response budget around
Rust's 30-second readiness deadline. Other RPCs retain their 10-second bound.
Only allowlisted launch-stage codes are retained; unreviewed codes remain
unknown. A service-unavailable result alone does not prove timeout. Quota I/O categories expose
neither paths nor raw HRESULTs, and unreviewed values remain generic `io`.

The supervisor creates and owns the actual restricted-token profile before
child launch, verifies token/profile agreement, and retains profile and
application directory handles with directory-list access and no delete
sharing. The producer publishes its native fixture beneath that profile's
`.coven/cave`, matching Rust token-profile discovery. A forged caller value
cannot redirect publication. The owned application subtree shares the existing
bootstrap and harness aggregate quotas. Quarantine must complete before pins
are released and owned profile/account cleanup proceeds; failure retains
ownership for retry.

The Windows bootstrap must contain exactly one canonical bounded gzip/base64
block matching the independently reviewed C# size and digest. The exact parent
script hash gate remains mandatory after this bounded source check. Quarantine regression tests mutate
and re-encode that source through the actual workflow verifier, preserving
coverage across the compressed representation.

The bound quota diagnostic distinguishes a readable follow-up from a missing
file or directory. Every outcome preserves the initial quota failure and
rejects the measurement. Persistent means another nonmissing exception, which
need not match the first.

The native regression proves SYSTEM or Administrators ownership using the
isolated process token profile before testing the discovery reader. Unknown
ACL metadata for a trusted profile owner remains unavailable and rejected. Follow-up observations do not
capture the original read and never authorize launch. Existing discovery
trust, quota, assertion and dependency policies remain unchanged. Native
protected validation and release acceptance remain outstanding.

The Windows reader retains the validated isolated token for synchronous quota
scans, including terminal accounting after account disablement. Private ACLs
and existing quota bounds remain enforced. The Coven daemon/observation source
is merged #1015 at `8c3735f374d6bc95e5b6fd107f7e7308fa26a2f8`.
At that historical checkpoint, SDK landing, both validator-scope rotations
and fresh protected validation remained required release gates.

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
artifact bytes. That repair required a newly bound SDK validator and rotation
of both protected scopes before fresh protected acceptance could be evaluated.
Later run outcomes are recorded separately below.

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
records and their reviewed GitHub attestations exist. SDK #276 has landed and
both validator scopes were rotated. The remaining gates are the complete
platform-record set, reviewed attestations, and canonical aggregate, as documented in
[`docs/workflows/client-v1-cross-repository-conformance.md`](docs/workflows/client-v1-cross-repository-conformance.md).

Before advancing this candidate after that blocker is resolved, copy the
canonical aggregate to
`docs/client-v1-cross-repository-results/96804bc483a063e41e9a9738a4ace61970f6c0a4.json`,
and add the sibling reviewed evidence index
`docs/client-v1-cross-repository-results/96804bc483a063e41e9a9738a4ace61970f6c0a4.index.json`.
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
workflow itself remains dispatch-only and accepts only `refs/heads/main` or
`refs/heads/release/sdk-v0.0.1`, but those workflow checks
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
commit is on `main` or the separately authorized, protected
`release/sdk-v0.0.1` line. Record its annotated tag object ID in the immutable #40
authorization. The release workflow verifies that the tag ref still names
that exact tag object and that the tag peels to the authorized commit/tree.
It repeats this check after protected approval and immediately before the
first npm publish.

## 5. Verify-mode workflow

Run `.github/workflows/release.yml` from `main` or the separately authorized,
protected `release/sdk-v0.0.1` line with mode `verify` and the
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
the exact selected release-ref workflow provenance, and performs the same check immediately before
the first npm publish. A moved, replaced, lightweight, or differently peeled
tag fails closed without invoking npm.

## 6. First-publish bootstrap

The documented npm trusted-publisher setup starts in an existing package's
settings. No supported credential-free first-package path has been established
for this release. Staged publishing is not a workaround: it requires an
existing package and npm >=11.15.0, whereas this release pins npm 11.5.1.
Unauthenticated registry 404 responses do not prove that names are available
or that packages do not exist privately.

The **First-publish bootstrap** is therefore a separate, explicitly approved
one-time manual operation, not a workflow mode. It requires actual #38
acceptance, the reviewed publication source/tag, immutable #40 SHIP
authorization, and separate bootstrap approval establishing the operator,
credential custody, package authority, audit controls and qualification gates.
The implementation below is preparation, not evidence that those gates have
been satisfied.

The original six-subject GitHub build bundle remains unchanged in purpose.
It cannot serve as npm's `--provenance-file`: npm 11.5.1 requires a single
subject named exactly `pkg:npm/%40opencoven/<package>@<version>` with the
actual tarball's SHA-512. Never split or rewrite a signed bundle. The isolated
`publication-candidate-attestation` job additionally signs four such subjects
and uploads four separate bare `attestation.json` files. It remains
checkout-free, shell-free and free of npm credentials, and OCI registry push
is explicitly disabled.

Those four statements use the npm 11.5.1 GitHub workflow/v1 SLSA profile:
the generic GitHub workflow build type, actual hosted Actions runner builder,
and source/ref/repository/run/attempt facts from trusted workflow contexts.
Only each tarball's verified SHA-512 comes from the unprivileged producer.
The profile does not claim that npm CLI performed the build or signing.
In-toto Statement/v1, SLSA provenance/v1 and the pinned attester's Sigstore
v0.3 format are required. This is source-supported compatibility, not a claim
that the future SDK bundles have been accepted by npm.

After actual SHIP and separate bootstrap approval, download the reviewed
candidate, original six-subject bundle and four additional artifacts by their
exact immutable IDs. Keep the candidate and original bundle in separate
directories. The npm provenance directory must contain exactly
`0/attestation.json`, `1/attestation.json`, `2/attestation.json` and
`3/attestation.json`, ordered core, cave, coven, sdk. Do not merge the four
same-named files into one directory.

From the exact clean reviewed release checkout with the pinned Node runtime
and the existing trusted Git/GitHub CLI paths, run the read-only verifier:

```bash
corepack pnpm@10.34.0 verify:bootstrap-provenance \
  --comment-id <actual-immutable-SHIP-comment-id> \
  --artifact-root <downloaded-publication-candidate> \
  --attestation-root <downloaded-six-subject-bundle> \
  --npm-provenance-root <downloaded-four-bundle-directory>
```

This command requires the full existing SHIP/source/tag/environment and
six-subject verification path; there is no offline acceptance, dry-run,
caller-supplied trust root or skip-approval switch. It additionally verifies
both tarball digests, the exact raw bundles and their downloaded artifact ZIP
digests, singleton statements and npm predicate, authenticated producer and
attester jobs, certificate source/workflow/ref/run/attempt/owner identities,
and public visibility/hosted-runner claims. It obtains trust through
`gh attestation trusted-root`'s authenticated TUF clients and supplies only
public-good Sigstore trust to `gh attestation verify --digest-alg sha512`.
GitHub-instance trust is not an alternative. It repeats the authoritative
SHIP/source/tag/policy checks before reporting success. The report does not
grant bootstrap approval and does not publish.

Require genuine final SDK bundle qualification with the pinned npm verifier
before the first publish; stubbed unit fixtures, public-reference provenance,
and `npm publish --dry-run` are not that qualification. Actual npm registry
acceptance remains a separate operational limit, and must not be claimed from
local source/format or signature checks alone. If qualification is incomplete
or authoritative registry policy is unresolved, stop before publishing any
immutable 0.0.1 version. Never publish a placeholder package/version as a probe.

Only after all approved pre-publication gates succeed may the authorized human:

1. use the separately approved least-privilege npm credential protected by
   account 2FA, outside the checkout and outside CI;
2. publish the four exact reviewed publication tarballs in canonical order,
   without rebuilding or repacking, supplying the corresponding unmodified
   bare bundle through `--provenance-file`, with `--access public`,
   `--ignore-scripts`, and the official registry explicitly selected;
3. verify each registry version, contents, integrity and actual npm provenance
   plus its GitHub build attestation, preserving the receipts;
4. immediately revoke the bootstrap credential and preserve the audit record.

`--provenance` and `--provenance-file` are mutually exclusive; do not enable
automatic provenance generation for this supplied-file procedure. No
credential-handling or bootstrap-publication code is provided. Private
candidate968 archives are not publication tarballs and cannot be unlocked,
repacked or relabeled by this procedure.

Do not add that credential to repository secrets, workflow files, shell
history, or normal release automation.

The `npm-release` self-review rule governs the normal protected workflow, not
this separate manual procedure. Do not infer a distinct workflow dispatcher
requirement for bootstrap from that rule alone; the explicit bootstrap
authorization must establish its participants and audit controls. This is not
bootstrap automation or permission to add a token fallback to normal OIDC
publication. Preflight observations about collaborators, npm authentication or
environment secrets are not bootstrap authorization or final release receipts.

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

Chat #285 landed as `6089bab8` after PR run `34932603467` and push run
`34932601258` attempt 2 passed. Three regressions reproduced the diagnostic
loss before the fix. This SDK binding refreshes the exact producer, source,
harness, complete Git fixtures and three bootstrap digests. Candidate, Cave,
Coven and original Chat consumer authorities remain unchanged. This proves
the diagnostic correction, not the failing hosted stage or Windows repair.
At this historical Chat #285 checkpoint, the SDK binding still required
reviewed landing, both validator scope rotations and fresh authenticated
protected validation. Scopes then selected SDK #272 (`129d4fde5`).

## Historical integrated native-preflight binding, Chat #292

Chat #292 landed as `b7578a653512095a84cd2cd87f33b2f2036221d5` after required
checks passed. Its signature is valid and its complete tree equals reviewed
head `92151f0600bc2db860a73f90d0d5abd8b354cb06`. The binding retains the explicit
intermediate authority path to harness `683e9991`; the equal-tree and parent
validation gates are unchanged. Compressed fixtures contain actual Git objects
for the delivery, reviewed head, both intermediates, and harness.

At that checkpoint, both validator scopes still selected SDK #274 (`1535e48e`).
The latest terminal protected run then was `34935323170`, using Chat #285 and SDK #274:
Linux/macOS records passed independent checks of identity, Cave timing, and all
197 ordered assertions. Windows failed at `phase1.native-scenarios.native-preflight`
and produced no record; cleanup separately reported child-open access denial
`ntstatus=c0000022`. Validation, attestation, and aggregation were skipped.

The next steps at that checkpoint were SDK binding verification and landing,
validator-scope rotation with readback, producer identity verification, and fresh
protected validation with supervisor authentication before environment approval.
Subsequent delivery and run outcomes are recorded below.
The four new preflight boundaries identify an operation; they do not prove a
Windows repair. No aggregate, publication, or release acceptance is claimed.

## Final Chat #293 binding checkpoint

On 2026-09-15, SDK [#276](https://github.com/OpenCoven/sdk/pull/276)
landed as `6b4e0d04e168c7ccd99df492a0494e223150e2ab` with the verified
Chat #293 binding. Both validator scopes were rotated and read back at that
actual merge. Protected [run 34951851914](https://github.com/OpenCoven/chat/actions/runs/34951851914),
attempt 1, was dispatched with Chat `6fa5dab5` and SDK #276. Its frozen workflow
and supervisor artifact passed independent authentication before environment
approval. Linux and macOS passed independent record identity, Cave timing,
scan, and all 197 ordered assertion checks each. Windows failed at
`phase1.native-scenarios.native-preflight-installation-rpc`, during
`app_installation_id` and before the installation-ID assertion. It published
no record; validation, attestation, and aggregation were skipped. This is
terminal partial evidence, not aggregate acceptance or publication approval.
The RPC's underlying failure remains unclassified; the stage does not prove
a recurrence of the earlier quota-monitor cause.

The prior SDK #275 run `34945048615` is terminal failure: Linux and macOS
records passed independent inspection, while Windows published no record and
failed its bounded checkout directory quota monitor. Downstream attestation
and aggregation were skipped. The [#38 checkpoint](https://github.com/OpenCoven/sdk/issues/38)
tracks subsequent platform records and exact aggregate acceptance.

SDK [#277](https://github.com/OpenCoven/sdk/pull/277) separately delivered
per-client discovery v2 retention, concurrent current-credential preservation,
and snapshots used to pin pairing authority. That development-source change is
not included in frozen candidate `96804bc4` or validated by the SDK #276 run.
SDK #299 and #301 subsequently delivered pairing guard regressions and managed
HPKE iterator continuity; both blockers in #296 are closed. Native adapter
adoption remains separate. Candidate and counterpart authorities stay frozen;
a later candidate needs its own review and evidence.

## Historical residual cleanup purpose binding, Chat #302

Chat #302 adds bounded `purpose=deletion|enumeration` labels to residual-profile
relative-open failures. Full CI [35095847759](https://github.com/OpenCoven/chat/actions/runs/35095847759)
passed, including native Windows denied-deletion and denied-directory-listing
controls. It also preserves the landed schema-v2 finalization diagnostics.
Quota retry investigation confirms `repeat=persistent` can represent a different
retry exception while preserving the initial denial; this does not establish
the protected ACL cause or a Windows repair.

That historical binding recorded the delivered producer, reviewed equal-tree source, binding
intermediate, and executable harness from actual Git objects. Historical
multi-edge fixtures and rejection controls remain intact. SDK validation gates,
candidate and consumer authorities, and protected policy are unchanged.

At that historical checkpoint, both validator scopes still selected SDK #284
(`e37b195c`), and the latest terminal run was `34977202052`. SDK #288 subsequently
landed and both scopes rotated to it for run `35100084575`, whose terminal result
is recorded above. SDK #290 then bound Chat #297 for run `35111662551`,
which failed Windows isolation. SDK #291 then bound Chat #305 for run `35125287541`, which failed
Windows execution-root cleanup. SDK #292 then bound Chat #309 for run `35138402347`, which failed
Windows operator Cave-home isolation. SDK #302 subsequently landed the Chat
#328 binding and both validator scopes rotated to it. Protected run
`35500732205` failed the Windows native build, as recorded above; no aggregate
or release acceptance is claimed.
