# @opencoven/cave-client

## 0.1.0

- Initial experimental SDK foundation. This version is not yet published.
- Align the vendored Cave Client v1 contract and normalized health result with
  the reviewed `OpenCoven/coven-cave` producer fixture.
- Share credential mutation queues across duplicate module copies and use
  atomic compare-and-delete when the configured secret store supports it.
- Accept unavailable (`0`) Windows inode metadata only when reviewed native
  path trust succeeds.
- Bind stored credentials to the Cave health `instanceId`, prove it before
  bearer use, and bracket pairing exchange with pre/post authority proofs.
- Treat failed post-exchange authority proof as a terminal re-pair condition
  because the single-use pairing secret has already been spent.
- Add strict canonical familiar, project, conversation, and message DTOs plus
  five optional caller-owned `CaveTransport` reads: `listFamiliars()`,
  `listProjects()`, `listConversations()`, `getConversation()`, and
  `listConversationMessages()`.
