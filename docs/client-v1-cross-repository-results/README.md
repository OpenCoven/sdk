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
aggregator first writes canonical bytes beneath the fixed owner-private
`.artifacts/client-v1-cross-repository-results/` root. A reviewed change copies
those exact bytes here under the frozen candidate commit filename, adds the
sibling `.index.json` file containing the exact protected-job artifact and
GitHub attestation digests, and sets `release.config.json`
`conformanceEvidence.aggregateRecord` to the aggregate path. Synthetic test
fixtures never enter this directory.
