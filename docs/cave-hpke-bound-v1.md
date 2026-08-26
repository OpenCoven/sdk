# Cave `hpke-bound-v1` consumer

`@opencoven/cave-client` consumes the authority contract merged in
OpenCoven/coven-cave at
`2a0ff9237e94e652e477b22f60fd6d721b9e6451`.

Normative vendored artifacts:

- `packages/cave/fixtures/contract-fixture.json` —
  `1b78125dab5b77414efd2d34e13315f542b197715ed26c6521f588e299abe61d`
- `packages/cave/fixtures/hpke-bound-v1-vectors.json` —
  `f806967291de12175277b6b24ac3c7bba912ae760fd8227fb21b1a4d5f5e6797`

The direct Node transport uses Base-mode requests and Auth-mode responses with
suite IDs `32/1/2`. It protects pairing poll/exchange plus familiar, project,
conversation, conversation-detail, and message reads. Health and pairing
create remain public.

Application semantics come only from the decrypted inner response. Plaintext,
forged, replacement-listener, or malformed wrappers produce one fixed
redacted transport failure and preserve credentials. A plaintext stale-key
result permits one rediscovery/reseal; authenticated replay-capacity permits
one deadline-bounded retry with fresh nonce, time, response key, and
ciphertext. No v2 path falls back to plaintext.

Managed adapters receive the strict frozen discovery v2 record. They retain
pairing secrets, bearers, HPKE private keys, request plaintext, and response
plaintext outside JavaScript. The adapter implements the named `*Hpke`
operations and returns only validated non-secret values with
`authentication: { mechanism: "hpke-bound-v1", keyId }` matching discovery.
There is no generic native request method. Chat's Rust implementation remains
a separate cross-repository handoff.
