---
"@opencoven/coven-client": minor
---

Add a separately opt-in, bounded `coven.session-policy.v1` discovery and
restricted-launch refusal consumer through the supported
`@opencoven/coven-client` release-package root. Preserve exact immutable request bytes,
SHA-256 and invocation/request correlation, strict raw JSON validation,
cancellation and deadlines, and explicit uncertain delivery without retries or
legacy fallback. Add a real opt-in Unix policy transport using the existing
connected-peer/path validation and bounded HTTP framing, with only the fixed
discovery GET and restricted-launch POST. Require a reviewed native peer
identity provider and explicitly reject Windows. Preserve the health client's
GET-only wire API and defaults. No accepted grant, runtime enforcement backend,
or grant lifecycle is supplied.

Ship the byte-exact fixed-time server request, refusal, discovery, and manifest
fixtures for cross-language conformance, with separate manifest provenance
pinned to the reviewed Coven producer commit.
