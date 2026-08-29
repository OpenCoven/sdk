# Client v1 cross-repository evidence aggregation

This repository owns the deterministic release-gate **aggregator**, not another
platform runner. Cave remains the assertion authority: every platform record
must embed the unmodified record produced by Cave's
`scripts/client-v1-conformance.mjs`, and aggregation imports that exact file from
the locked Cave checkout to obtain the expected assertion set, coverage check,
summary logic, record renderer, findings, and Cave-only `notCovered` record.

No command in this repository starts a platform run, launches Cave or Coven,
touches a native keychain, publishes a package, or mutates release state. Chat's
native harness produces one already-redacted platform record for each frozen
target:

- `darwin-arm64`
- `linux-x64`
- `win32-x64`

## Platform record contract

Each input must satisfy
[`conformance/client-v1-cross-repository-evidence.schema.json`](../../conformance/client-v1-cross-repository-evidence.schema.json)
and the stricter executable parser in
[`scripts/conformance-contract.mjs`](../../scripts/conformance-contract.mjs).
Unknown or missing fields fail. JSON is bounded to 1 MiB, 50,000 nodes, 32
levels, and 16 KiB per string.

The SDK schema deliberately treats the nested Cave record as an opaque object.
The executable validator re-renders it with Cave's loaded
`renderConformanceRecord` export and requires exact equality, so the SDK does
not maintain a second copy of Cave's record shape.

The record names exact Cave, Coven, SDK, and Chat commits; Cave and Coven
release versions; Node and pnpm versions; the four canonical SDK tarball
SHA-256 values; the Cave assertion engine, committed assertion registry,
contract fixture, HPKE vector, and consumer lock SHA-256 values. The assertion registry SHA-256 is computed only from the tracked
`conformance/client-v1-cross-repository-assertions.json` blob at the SDK commit
named by the records. Those commits, releases, and digests must be identical on
all three platforms. The aggregator also requires a clean SDK Git top-level;
there is no registry override.

SDK and Chat assertions come from
[`conformance/client-v1-cross-repository-assertions.json`](../../conformance/client-v1-cross-repository-assertions.json).
The aggregator delegates missing, duplicate, and unexpected assertion detection
to Cave's generic `checkAssertionCoverage` helper. Every Cave, SDK, and
platform-applicable Chat assertion must appear once and pass. A failure or skip
fails aggregation.

The structured `coverage` object must contain `cave`, `coven`, `sdk`, and
`chat`, all set to `true`; none can disappear into prose. The explicit
`notCovered` list accepts only the non-release scope IDs `write-apis`,
`oauth-ui`, `remote-peer`, and `cross-process-pairing`, each paired with a
stable diagnostic ID. Cave's nested Cave-only record continues to carry Cave's
authoritative scope statement unchanged.

## Isolation and retained-data proof

Platform records contain labels and digests, never temporary or operator paths.
They must prove:

- process-owned temporary Cave, Coven, consumer, and native-store roots;
- verified ownership and completed cleanup for every root;
- loopback-only authority traffic;
- no source-checkout or workspace-link dependency;
- unchanged before/after digests for the operator Cave home, Coven home, native
  credential store, and projects;
- no retained private paths or socket handles.

Before accepting either an input or the aggregate, the bounded scan rejects
credential-shaped values, authorization headers, pairing-secret headers,
private keys, token formats, transcript/content fields, command output, private
filesystem paths, Windows pipe handles, and oversized strings or structures.

## Aggregate three completed records

Use a clean Cave checkout at the exact commit named by every platform record.
`--cave-root` must be that repository's Git top-level, and the engine must be a
tracked regular file whose executed bytes equal its `HEAD` Git blob:

```bash
corepack pnpm@10.34.0 conformance:aggregate -- \
  --cave-root ../coven-cave \
  --record evidence/darwin-arm64.json \
  --record evidence/linux-x64.json \
  --record evidence/win32-x64.json \
  --out docs/client-v1-cross-repository-results/<candidate>.json
```

The output path must not already exist. Publication writes a complete sibling
file and atomically hard-links it into place, so a concurrent creator wins
without being overwritten. Input order does not affect output: records are
emitted in canonical platform order, and the aggregate contains no checkout or
input path. Run the focused contract tests with:

```bash
corepack pnpm@10.34.0 test:conformance-contract
```

The ordinary SDK `verify` command already includes these tests. Real platform
execution remains an explicit release operation owned by the native consumer;
CI validates the parser, registry, failure behavior, redaction bounds, and
determinism without pretending to provide native evidence.
