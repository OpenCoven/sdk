# @opencoven/coven-client

A constrained Coven health client. Consumers provide the transport; this
package does not perform daemon discovery or connection at import time, and it
normalizes malformed health responses to a stable SDK error. Valid health
capabilities require boolean `sessions`, `events`, and `structuredErrors`
fields. The public transport type keeps `eventCursor` as `string` for source
compatibility, while runtime validation currently accepts only the supported
`'sequence'` value.
