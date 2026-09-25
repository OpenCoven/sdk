# Client v1 cross-repository results

This directory retains immutable, redacted aggregates accepted by
`scripts/aggregate-client-v1-conformance.mjs` and their reviewed evidence
indexes.

A result is added only after the exact same candidate has produced complete
`darwin-arm64`, `linux-x64`, and `win32-x64` platform records and the SDK-side
aggregator accepts all three.

The first passing record is
[`96804bc483a063e41e9a9738a4ace61970f6c0a4.json`](96804bc483a063e41e9a9738a4ace61970f6c0a4.json),
for the frozen 0.0.1 candidate. Protected Chat run
[36113801474](https://github.com/OpenCoven/chat/actions/runs/36113801474)
produced its three platform records. The run was dispatched from Chat `main` at
`f4fbb423c811cc33ddbbc9a388933aa4089560df`, which the lock binds by its descent
to producer `b10910545b14133a619e56641e5692a4335c83c4`. Validator
`185d626462105b5e26e45071629eadb04eb65fd9` accepted and attested the records.
The sibling `.index.json` names each protected job, deployment, artifact and
attestation bundle. The platform artifacts expire on 2026-10-25 (UTC); after
that date live re-verification cannot repeat, and a fresh protected run is
needed to re-establish the evidence.

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
