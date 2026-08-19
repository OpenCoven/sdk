# @opencoven/cave-client

A constrained Cave health client. Consumers provide the transport; this package
does not discover endpoints or credentials, and health checks reject malformed
responses or incompatible minimum client versions deterministically. It also
exports public helpers for parsing and digest-verifying the reviewed
foundation-only Cave contract fixture.

## License

AGPL-3.0-only OR MIT. See [LICENSE](LICENSE).
