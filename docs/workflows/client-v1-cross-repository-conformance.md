# Client v1 cross-repository evidence contract

This repository owns the deterministic SDK #38 **validator and aggregator**. It
does not run the native journey, launch Cave or Coven, touch a credential
store, publish packages, or claim that conformance has passed.

The contract validates record contents and committed source identities; it is
not a signature service for arbitrary local JSON. Release operators must admit
records only from the named protected platform jobs and review those job/artifact
identities before retaining the aggregate.

Chat's separate native harness must later produce one observed record for each
platform, in this exact matrix and order:

1. `darwin-arm64`
2. `linux-x64`
3. `win32-x64`

Aggregation runs only on a Darwin or Linux coordinator. Windows remains a
required record platform, but Node does not expose the directory-relative
publication primitives needed to support the aggregator safely on Windows.

There is no passing aggregate in this repository yet.

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
- harness and scanner names and versions; and
- the assertion-registry path, size, and SHA-256.

The validator commit is deliberately **not** the package candidate commit. Each
platform record identifies the later SDK validator commit and tree separately.
The aggregator validates its own clean checkout against that identity.

[`conformance/client-v1-cross-repository-assertions.json`](../../conformance/client-v1-cross-repository-assertions.json)
contains the complete frozen assertion registry. Its Cave list was imported
once from the exact locked Cave engine with TTL and authority-takeover enabled.
Runtime aggregation does not ask the engine to select IDs dynamically.

## Platform harness production interface

The native producer remains Chat-owned. Its implementation may evolve in a
separate Chat commit, but a compatible invocation must receive these six clean
Git checkouts:

| Checkout | Required identity |
| --- | --- |
| SDK candidate | Frozen candidate commit and tree from the lock |
| SDK validator | The later committed validator/schema/registry/lock checkout |
| Cave | Frozen Cave commit and tree from the lock |
| Coven | Frozen Coven commit and tree from the lock |
| Chat production source | Frozen Chat commit and tree from the lock |
| Chat harness | Exact harness commit and tree named by the produced records |

Before running any authority bytes, the producer must validate each checkout's
Git top level, canonical GitHub repository identity, exact `HEAD`, exact
`HEAD^{tree}`, and the absence of staged, unstaged, and untracked files. It must
also reject ignored untracked files; use fresh detached aggregation checkouts,
not build worktrees containing ignored dependency or output directories. It
must not use workspace links or source-checkout package imports. The SDK
packages come only from the four locked Chat vendor paths.

A Chat invocation is expected to follow this interface, with operator-specific
paths supplied at runtime and never retained:

```bash
corepack pnpm@10.34.0 test:phase1-conformance -- \
  --chat-root <clean-chat-source-checkout> \
  --chat-harness-root <clean-chat-harness-checkout> \
  --sdk-root <clean-sdk-candidate-checkout> \
  --sdk-evidence-root <clean-sdk-validator-checkout> \
  --cave-root <clean-cave-checkout> \
  --coven-root <clean-coven-checkout>
```

The producer writes one JSON record outside all source checkouts. It must run
the exact committed Cave engine bytes, not the mutable working-tree file. It
must fail without retaining a record if any assertion, cleanup proof, checkout
proof, artifact proof, or scan fails.

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
Unix private/home-like absolute paths (including `/mnt`, `/private`, and
`/var`), Windows drive/UNC/device paths, named pipes, abstract Unix sockets,
URLs, and email-shaped operator identifiers.

Approved UUID invocation IDs, 32-hex opaque root IDs, SHA-256 values, versions,
diagnostic IDs, repository slugs, relative locked artifact paths, and public
Client v1 API routes remain allowed.

## Aggregate three completed records

Run from the exact clean SDK validator checkout:

```bash
corepack pnpm@10.34.0 conformance:aggregate -- \
  --candidate-root <clean-sdk-candidate-checkout> \
  --cave-root <clean-cave-checkout> \
  --coven-root <clean-coven-checkout> \
  --chat-root <clean-chat-source-checkout> \
  --harness-root <clean-chat-harness-checkout> \
  --record <darwin-record.json> \
  --record <linux-record.json> \
  --record <windows-record.json> \
  --out acc38488f00860d246c3c553375634d64806eabb.json
```

`--out` is a filename, not a path. The CLI publishes only under the fixed
owner-private root:

```text
.artifacts/client-v1-cross-repository-results/
```

The destination must not exist. The CLI prepares and `fsync`s complete UTF-8
bytes, uses an owner-private staging directory inside the output root and a
unique per-process temporary file, anchors publication operations to the
validated output directory, and hard-links the complete file into place.
The hard link's no-overwrite `EEXIST` result serializes concurrent creators
without a persistent stale lock. The CLI verifies the output inode and parent
identity before and after publication and `fsync`s both directories. Symlink
roots, unsafe ownership or permissions, parent replacement, an existing
destination, and concurrent creators fail closed. Rollback removes only files
whose inode matches the CLI's exact temporary file.

Aggregate JSON is recursively key-sorted, two-space indented UTF-8 with LF
line endings and exactly one trailing newline. Arrays retain their contractual
order. Platform input order and object key order therefore cannot change the
published bytes.

After human review, copy the exact aggregate bytes into:

```text
docs/client-v1-cross-repository-results/acc38488f00860d246c3c553375634d64806eabb.json
```

and set `release.config.json` `conformanceEvidence.aggregateRecord` to that
relative filename in the same reviewed change. Do not set it before a real
three-platform aggregate exists. Release readiness reparses the complete
canonical aggregate, revalidates every embedded platform record against the
lock, registry, and schema loaded from the aggregate's recorded validator
commit, recomputes assertion totals, binds the candidate back to
`release.config.json`, and verifies the recorded validator tree, contract, and
schema bytes from Git history.

Run the focused validator suite with:

```bash
corepack pnpm@10.34.0 test:conformance-contract
```

CI tests the parser, schema, lock, registry, checkout failures, scanner,
canonical serialization, and publication races with synthetic fixtures. Those
fixtures are not platform evidence and are never retained as a passing result.
