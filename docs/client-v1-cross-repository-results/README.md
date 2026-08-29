# Client v1 cross-repository results

This directory retains immutable, redacted aggregates accepted by
`scripts/aggregate-client-v1-conformance.mjs` and their reviewed evidence
indexes.

There is no passing record yet. A result is added only after the exact same
candidate has produced complete `darwin-arm64`, `linux-x64`, and `win32-x64`
platform records and the SDK-side aggregator accepts all three.

The frozen Chat commit currently has no schema-v2 platform evidence producer,
so aggregation and release readiness remain fail-closed.

After a compatible producer is frozen and real protected jobs pass, the
authoritative verifier queries the frozen Chat workflow/run/job/artifact
records, downloads each primary platform record, verifies its GitHub
build-provenance attestation and bundle, and passes only those downloaded bytes
to the aggregator. The aggregator writes canonical bytes beneath the fixed
owner-private `.artifacts/client-v1-cross-repository-results/` root.

A reviewed change copies those exact bytes here under the frozen conformance
candidate commit filename, adds the sibling `.index.json` locator containing
the exact protected-job and attestation expectations, and sets
`release.config.json` `conformanceEvidence.aggregateRecord` to the aggregate
path. Release readiness repeats the live GitHub verification and requires the
freshly generated aggregate to byte-match the committed aggregate. A committed
JSON aggregate/index claim alone never passes, and these private-source
conformance bytes are not publication candidates. Synthetic test fixtures
never enter this directory.
