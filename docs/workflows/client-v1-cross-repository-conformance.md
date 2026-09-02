# Client v1 cross-repository evidence contract

This repository owns the deterministic SDK #38 **validator and aggregator**. It
does not run the native journey, launch Cave or Coven, touch a credential
store, publish packages, or claim that conformance has passed.

The contract validates record contents and committed source identities; it is
not a signature service for arbitrary local JSON. A committed aggregate or
evidence index is never authentication. Release readiness independently
queries GitHub for the frozen protected workflow, run, job, and artifact,
downloads each primary record, verifies its real GitHub build-provenance
attestation, and aggregates only those downloaded bytes.

Chat's separate native harness must later produce one observed record for each
platform, in this exact matrix and order:

1. `darwin-arm64`
2. `linux-x64`
3. `win32-x64`

Aggregation runs only on a Darwin or Linux coordinator. Committed-evidence
verification on those hosts authenticates the root-owned, non-writable
`/usr/bin/git` executable instead of resolving Git from `PATH`. Windows remains
a required record platform, but Node does not expose the directory-relative
publication primitives needed to support the aggregator safely on Windows.

There is no passing aggregate in this repository yet. The frozen Chat
production source remains
`edd4728792321771496df58bfc0e6122908a96ec`; the compatible evidence producer
is the reachable commit `df77381023283779358a071ea0a5871208b4e618`,
whose protected-producer behavior is the parent authority
`a9d72cae6b300cddbf24294dbbb741f441a71df5`.
The frozen workflow separates platform production, exact SDK validation,
provenance attestation, and aggregation. Its lock records the validation and
attestation job identities, the three static artifact names and record paths,
the pinned download and attestation actions, the exact security-critical
bootstrap, reviewed Unix tool-path source and step, production, validation, and
digest-comparison script hashes, and the protected
`CLIENT_V1_CONFORMANCE_VALIDATOR_REVISION` variable. Aggregation and release
readiness remain fail closed until all three protected platform records exist
and their live GitHub attestations are reviewed. Those records remain pending
until this SDK validator merges and the protected environment revision is
rotated to that merged SDK commit.

## Frozen reviewed inputs

[`conformance/client-v1-cross-repository-lock.json`](../../conformance/client-v1-cross-repository-lock.json)
is the single machine-readable artifact and source lock. It freezes:

- SDK package candidate
  `acc38488f00860d246c3c553375634d64806eabb` and its committed tree;
- the private-source **conformance artifact** `release-manifest.json`,
  including its exact 1,031-byte canonical JSON representation and SHA-256;
- the four package names, versions, release filenames, Chat vendor paths,
  sizes, SHA-256 values, and order;
- the SDK candidate's Cave contract fixture, fixture digest file, provenance
  file, HPKE vector file, and HPKE digest file;
- the exact Cave, Coven, and Chat production commits and committed trees;
- Cave's assertion engine, source fixture, and HPKE vector file metadata;
- Chat's consumer lock and vendored SDK package metadata;
- Node, pnpm, Rust, and Tauri versions;
- scanner names and versions;
- the exact ordered platform matrix;
- the immutable schema identity, path, version, size, and SHA-256;
- the assertion-registry path, size, and SHA-256; and
- the frozen Chat package manifest and available contract-canary bytes that
  prove the frozen commit cannot produce this schema.

The schema identity is
`urn:opencoven:schema:client-v1-cross-repository-platform-evidence:2`, not a
mutable branch URL. The schema embeds the exact assertion-registry metadata.
Runtime validation checks lock bytes to schema bytes, then the schema binding
to the exact registry bytes and ordered matrix.

The immutable schema-v2 field names `releaseManifest` and `sdkPackages` refer
only to the frozen conformance artifact set consumed by Chat. They are not npm
publication candidates. Publication uses a separate schema-v2 artifact
manifest, source commit, and #40 review identity defined by
[`conformance/release-artifact-manifest.schema.json`](../../conformance/release-artifact-manifest.schema.json)
and `release.config.json` `publicationCandidate`.

The validator commit is deliberately **not** the package candidate commit. Each
platform record identifies the later SDK validator commit and tree separately.
The aggregator validates its own clean checkout against that identity.

[`conformance/client-v1-cross-repository-assertions.json`](../../conformance/client-v1-cross-repository-assertions.json)
contains the complete frozen assertion registry. Its Cave list was imported
once from the exact locked Cave engine with TTL and authority-takeover enabled.
Runtime aggregation does not ask the engine to select IDs dynamically.

## Platform producer compatibility

The frozen producer uses Chat's existing schema-v1 authority journey as an
internal source, but emits schema v2 only after receiving every frozen SDK and
Chat assertion from an exact observed-result map. Missing, duplicate,
unexpected, skipped, failed, or blocked observations produce no record.

The protected dispatch requires a full lowercase `validator_revision`. The
Chat commit does not pin that SDK revision, so the SDK validator can freeze the
already-committed Chat producer without creating a mutual commit-hash cycle.
The selected checkout still supplies and binds the exact validator
commit/tree, contract, schema, registry, and frozen-lock bytes in every record.
The protected environment is `client-v1-conformance`, environment ID
`20863036831`. GitHub must report administrator bypass disabled, exactly one
required reviewer with immutable user ID `68980965`, `prevent_self_review` set
to `false` so the dispatcher and sole reviewer can approve, no wait-timer rule
(zero minutes), and protected-branch-only deployment policy. Aggregation
rejects any policy drift.

## Exact platform record

Every input must satisfy both:

- [`conformance/client-v1-cross-repository-evidence.schema.json`](../../conformance/client-v1-cross-repository-evidence.schema.json);
- the stricter executable parser in
  [`scripts/conformance-contract.mjs`](../../scripts/conformance-contract.mjs).

The JSON Schema is executed during aggregation. Unknown fields fail at every
SDK-owned object because `additionalProperties` is `false`. Input JSON is
limited to 1 MiB, 50,000 nodes, 32 levels, and 16 KiB per string.

The schema-v2 fields are:

| Field | Required meaning |
| --- | --- |
| `platform` | One exact native matrix identifier |
| `timing` | Canonical UTC start/end timestamps and their exact millisecond duration |
| `environment` | OS, architecture, Node, pnpm, Rust, Tauri, native custody backend/availability, and Coven peer/pipe identity backend/availability |
| `releases` | Exact Cave and Coven release versions |
| `provenance.candidate` | Frozen packed SDK candidate commit and tree |
| `provenance.validator` | Later SDK validator commit/tree plus committed contract and schema metadata |
| `provenance.cave` | Frozen Cave source commit and tree |
| `provenance.coven` | Frozen Coven source commit and tree |
| `provenance.chat` | Frozen Chat production source commit and tree |
| `harness` | Harness path/name, version, repository, commit, tree, and opaque UUID invocation ID; no raw command |
| `artifacts` | Frozen lock, registry, manifest, four packages, candidate Cave files, Cave authority files, consumer lock, and Chat vendor files |
| `caveRecord` | Exact Cave-rendered record, re-rendered for equality by the committed Cave engine |
| `sdkAssertions` | Every frozen SDK ID once, in order, with `pass` |
| `chatAssertions` | Every common plus platform Chat ID once, in order, with `pass` |
| `coverage` | `cave`, `coven`, `sdk`, and `chat`, all `true` |
| `notCovered` | The complete four-entry frozen exclusion set, in order |
| `isolation` | Opaque 32-hex root IDs, ownership/removal proof, and unchanged operator-state digests |
| `scans` | Passing producer redaction and retained-evidence scans with exact scanner names/versions |

The platform-specific custody backends are `macos-keychain`,
`linux-keyring`, and `windows-credential-manager`. The Coven identity backends
are `unix-peer-credentials` on Darwin/Linux and
`windows-named-pipe-client-identity` on Windows. Availability must be `true`.

`notCovered` is exactly:

- `cross-process-pairing`
- `oauth-ui`
- `remote-peer`
- `write-apis`

It is not an arbitrary subset. SDK and Chat are required covered subjects and
cannot appear in it.

## Redaction and isolation

Records retain opaque IDs, digests, versions, relative reviewed artifact paths,
and stable diagnostic IDs. They do not retain operator paths or identifiers.

The validator normalizes keys across case and punctuation before rejecting
pairing secrets, bearer/token/password/credential/private-key/API-key fields;
prompt/message/content/attachment/command-output/private-cause fields;
headers, URLs, socket or pipe handles; and raw diagnostics. It also rejects
all absolute POSIX paths, Windows drive/UNC/device paths, named pipes,
abstract Unix sockets, `file:` and network URLs, and email-shaped operator
identifiers. These values are rejected after punctuation as well as at string
boundaries, including inside Cave detail and finding text.

Approved UUID invocation IDs, 32-hex opaque root IDs, SHA-256 values, versions,
diagnostic IDs, repository slugs, relative locked artifact paths, and public
Client v1 API routes remain allowed. Route allowance is field-aware: the exact
Cave `findings` and `notCovered` grammar may contain reviewed literals such as
`/api/client/v1` and `/familiars`, but unrestricted content and arbitrary
absolute filesystem paths remain rejected.

## Aggregate three completed records

Aggregation becomes available only after the frozen lock names a compatible
producer. It then requires the exact clean candidate, Cave, Coven, Chat source,
and Chat producer checkouts plus one protected-job record for every platform
in locked order. `--out` remains a filename, not a path, and publication is
restricted to the fixed owner-private root:

```text
.artifacts/client-v1-cross-repository-results/
```

The destination must not exist. The CLI holds an exclusive owner-private
directory lock, creates the temporary file directly in the fixed evidence
directory, and keeps its descriptor open from the initial write through final
publication verification. It verifies exact bytes through that descriptor
before linking, opens the destination without following symlinks, verifies
descriptor identity and bytes on both names, removes the temporary name,
requires one remaining link, verifies the bytes again, and `fsync`s the file
and directory. Same-inode rewrites, temporary-path replacement, output-root or
lock replacement, unexpected aliases, concurrent creators, and durability
failures trigger exact-inode rollback and fail closed.

Aggregate JSON is recursively key-sorted, two-space indented UTF-8 with LF
line endings and exactly one trailing newline. Arrays retain their contractual
order. Platform input order and object key order therefore cannot change the
published bytes.

After the protected jobs complete, the SDK verifier downloads and authenticates
the records before producing the exact aggregate bytes. Copy those bytes into:

```text
docs/client-v1-cross-repository-results/acc38488f00860d246c3c553375634d64806eabb.json
```

Create the sibling reviewed evidence index:

```text
docs/client-v1-cross-repository-results/acc38488f00860d246c3c553375634d64806eabb.index.json
```

The index records the expected aggregate and primary-record digests, exact
producer commit/harness/workflow/source-ref identity, workflow byte
size/SHA-256, the dedicated two-job graph, hosted-runner labels, protected
environment ID, one shared run attempt, unique matrix job and deployment IDs,
artifact digest, attestation subject digest, and attestation-bundle digest. It
also freezes the platform-derived artifact/record path templates, SLSA
predicate, signer workflow, signer digest, source digest, and prohibition on
self-hosted runners. These values are locators and review expectations, not
self-authenticating claims.

Release readiness uses `gh api` to fetch the workflow bytes at the frozen Chat
commit and requires their exact reviewed size and SHA-256. The dedicated
workflow is then parsed with the same unambiguous YAML parser used for the
release workflow. It must use printable ASCII with LF endings and a final
newline, and cannot use anchors, aliases, merge keys, block scalars, duplicate
keys, or prototype-shadowing keys.

The parsed document must equal the complete reviewed structure: only a manual
dispatch trigger with one required string input named `validator_revision`,
top-level `contents: read`, the exact ordered
platform/runner matrix, the protected environment, the exact job permissions,
and exactly five jobs. The protected matrix job has exactly 19 ordered steps:
pinned checkout without persisted credentials, pinned Node and pnpm setup,
frozen dependency and Rust setup, a Linux-only exact package setup for
`dbus-daemon`, `gnome-keyring`, and `libsecret-tools`, exact
Node/pnpm/Rust/Tauri verification, exact harness size/SHA-256 verification,
reviewed resolution of only `node`, `pnpm`, and `rustup` into a minimal Unix
tool path, and invocation of the frozen harness with the selected validator
SHA. The supervised Unix step must consume that exact step output and cannot
forward ambient `PATH` or fall back to it. Windows bootstrap uses
`ProcessStartInfo` and `Process.ExitCode`, never `$LASTEXITCODE`, and launches
the pinned npm and pnpm JavaScript entrypoints directly through pinned Node
rather than `.cmd` or `.bat` shims. Linux production runs inside Chat's
committed private D-Bus/Secret Service wrapper. The remaining steps perform
read-only canonical JSON and platform validation, pinned official artifact
upload, and pinned official provenance attestation. The artifact name occurs
as a scalar exactly once, and the record path is identical across generation,
validation, upload, and attestation. There is no mutable step after validation.

No other action, command, permission, output, condition, expression, local or
reusable workflow, upload path, or attestation path is accepted. The
aggregation job has no permissions and can only confirm successful completion
of the protected matrix; it cannot generate, upload, attest, or replace a
platform record. This structural template is exercised synthetically in tests
only. The committed lock marks the reachable Chat producer at
`df77381023283779358a071ea0a5871208b4e618` compatible with the reviewed
schema-v2 workflow bytes. Release readiness remains blocked until this SDK
validator merges, `CLIENT_V1_CONFORMANCE_VALIDATOR_REVISION` is rotated to the
merged revision, and all three protected platform records and their GitHub
attestations exist and are reviewed.

The three records must come from one exact run attempt. The verifier fetches
the attempt's complete job list and requires exactly the three successful
matrix expansions plus the successful aggregation job, with no sibling or
alternate job. Because the artifact API does not expose its producing job, the
index also freezes one deployment ID per matrix job. The verifier fetches the
exact environment, requires current required-reviewer and protected-branch
rules, fetches each deployment and all statuses, and requires both a
pre-execution `pending`/GitHub Actions `waiting` status and a successful status
whose `log_url` and `target_url` identify the exact numeric matrix job ID. It
then fetches the unique run artifact and downloads it with:

```bash
gh run download <run-id> \
  --repo OpenCoven/chat \
  --name client-v1-conformance-<platform>
```

It then downloads the bundle and runs the equivalent of:

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
`gh attestation` subprocesses. The validator scrubs both `GH_TOKEN` and
`GITHUB_TOKEN` before local Git inspection and before loading or invoking the
committed Cave assertion engine; package build and packing subprocesses use
their own sterile token-free environment.

The verifier checks the attestation certificate's source repository, source
ref, source digest, signer digest, GitHub-hosted runner identity, and exact
run-invocation URI. The attestation subject must equal the downloaded canonical
record digest, and the bundle digest must equal the reviewed index. Only the
three downloaded records are aggregated. That generated aggregate must
byte-match the committed aggregate.

There is intentionally no offline acceptance mode. Supplying only committed
JSON claims, even with plausible GitHub IDs and matching copied hashes, fails
closed because the verifier cannot authenticate the primary platform bytes or
job identities. Only after live verification may the aggregate, index, and
`release.config.json` `conformanceEvidence.aggregateRecord` change be reviewed
together.

Release readiness reads only committed regular files at `HEAD`, rejects any
working-tree drift, requires the exact sibling evidence index, revalidates the
lock-schema-registry chain, and checks validator/candidate ancestry and bytes
from Git history. `.node-version` is part of the exact validator runtime and
the process must be Node `v24.18.1`. The release workflow checks out the exact
frozen Cave source and supplies it through
`OPENCOVEN_CAVE_AUTHORITY_ROOT`; the verifier executes the exact committed Cave
engine bytes and re-renders every Cave record rather than trusting
aggregate-copied summaries, findings, scan labels, isolation labels, or
harness claims.

Run the focused validator suite with:

```bash
corepack pnpm@10.34.0 test:conformance-contract
```

CI tests the parser, schema, lock, registry, checkout failures, scanner,
canonical serialization, and publication races with synthetic fixtures. Those
fixtures are not platform evidence and are never retained as a passing result.
