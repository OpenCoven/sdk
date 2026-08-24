# @opencoven/cave-client

## 0.1.0

- Initial experimental SDK foundation. This version is not yet published.
- Align the vendored Cave Client v1 contract and normalized health result with
  the reviewed `OpenCoven/coven-cave` producer fixture.
- Share credential mutation queues across duplicate module copies and use
  atomic compare-and-delete when the configured secret store supports it.
