# Client v1 cross-repository results

This directory retains immutable, redacted aggregates accepted by
`scripts/aggregate-client-v1-conformance.mjs`.

There is no passing record yet. A result is added only after the exact same
candidate has produced complete `darwin-arm64`, `linux-x64`, and `win32-x64`
platform records and the SDK-side aggregator accepts all three.

The aggregator first writes canonical bytes beneath the fixed owner-private
`.artifacts/client-v1-cross-repository-results/` root. A reviewed change then
copies those exact bytes here under the frozen candidate commit filename and
sets `release.config.json` `conformanceEvidence.aggregateRecord` to that
relative path. Synthetic test fixtures never enter this directory.
