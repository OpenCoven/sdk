# Client v1 cross-repository evidence contract

This repository owns the deterministic SDK #38 **validator and aggregator**. It
does not run the native journey, launch Cave or Coven, touch a credential
store, publish packages, or claim that conformance has passed.

The contract validates record contents and committed source identities; it is
not a signature service for arbitrary local JSON. Release operators must admit
records only from the named protected platform jobs and review those
job/artifact identities before retaining the aggregate and its evidence index.

Chat's separate native harness must later produce one observed record for each
platform, in this exact matrix and order:

1. `darwin-arm64`
2. `linux-x64`
3. `win32-x64`

Aggregation runs only on a Darwin or Linux coordinator. Windows remains a
required record platform, but Node does not expose the directory-relative
publication primitives needed to support the aggregator safely on Windows.

There is no passing aggregate in this repository yet. The exact frozen Chat
commit `dbbcf3a71155730f0e707e181ef3ca7e770c719f` has no schema-v2 platform
evidence producer, no `scripts/phase1-conformance.mjs`, and no
`test:phase1-conformance` package script. The lock records that external
blocker, and both aggregation and release readiness fail closed until a
reviewed lock update names an exact compatible producer commit and protected
workflow.

## Frozen reviewed inputs

[`conformance/client-v1-cross-repository-lock.json`](../../conformance/client-v1-cross-repository-lock.json)
is the single machine-readable artifact and source lock. It freezes:

- SDK package candidate
  `acc38488f00860d246c3c553375634d64806eabb` and its committed tree;
- `release-manifest.json`, including its exact 1,031-byte canonical JSON
  representation and SHA-256;
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

The validator commit is deliberately **not** the package candidate commit. Each
platform record identifies the later SDK validator commit and tree separately.
The aggregator validates its own clean checkout against that identity.

[`conformance/client-v1-cross-repository-assertions.json`](../../conformance/client-v1-cross-repository-assertions.json)
contains the complete frozen assertion registry. Its Cave list was imported
once from the exact locked Cave engine with TTL and authority-takeover enabled.
Runtime aggregation does not ask the engine to select IDs dynamically.

## Platform producer compatibility blocker

The frozen Chat source contains only `scripts/contract-canary.mjs`, invoked by
`test:contract-canary`. That command accepts SDK and Cave roots and verifies a
contract canary; it does not accept the six documented conformance checkouts
and does not emit the schema-v2 platform record below. There are therefore no
legacy platform records with enough independently verifiable information to
adapt without inventing Cave, SDK, Chat, isolation, scan, environment, or
protected-job claims.

This SDK intentionally provides no schema-v1-to-v2 upcast. A future compatible
producer requires a reviewed lock change that names an existing exact Chat
commit and tree, committed package manifest and harness bytes, record schema
version 2, and the exact protected workflow path, job, and environment. Until
then, `conformance:aggregate` reports the frozen producer blocker before
accepting records.

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
Client v1 API routes remain allowed.

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

After protected-job and human review, copy the exact aggregate bytes into:

```text
docs/client-v1-cross-repository-results/acc38488f00860d246c3c553375634d64806eabb.json
```

Create the sibling reviewed evidence index:

```text
docs/client-v1-cross-repository-results/acc38488f00860d246c3c553375634d64806eabb.index.json
```

The index binds the committed aggregate digest, each canonical primary
platform-record digest, the exact producer commit/harness/workflow identity,
protected run/job IDs, artifact digest, attestation subject digest, and
attestation-bundle digest. It also freezes the SLSA predicate, signer workflow,
signer digest, source digest, and the prohibition on self-hosted runners.

For each platform, reviewers must download the named protected-job artifact
and bundle and run the equivalent of:

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

Reviewers then verify the downloaded artifact digest and attestation-bundle
digest, extract the canonical record, and verify its digest against the index.
The local validator deliberately does not turn self-asserted run IDs into a
network trust oracle; the cryptographic GitHub verification and review are the
admission step required by the committed index. Only then may the aggregate,
index, and
`release.config.json` `conformanceEvidence.aggregateRecord` change be reviewed
together.

Release readiness reads only committed regular files at `HEAD`, rejects any
working-tree drift, requires the exact sibling evidence index, revalidates the
lock-schema-registry chain, and checks validator/candidate ancestry and bytes
from Git history. The release workflow checks out the exact frozen Cave source
and supplies it through `OPENCOVEN_CAVE_AUTHORITY_ROOT`; the verifier executes
the exact committed Cave engine bytes and re-renders every Cave record rather
than trusting aggregate-copied summaries, findings, scan labels, isolation
labels, or harness claims.

Run the focused validator suite with:

```bash
corepack pnpm@10.34.0 test:conformance-contract
```

CI tests the parser, schema, lock, registry, checkout failures, scanner,
canonical serialization, and publication races with synthetic fixtures. Those
fixtures are not platform evidence and are never retained as a passing result.
