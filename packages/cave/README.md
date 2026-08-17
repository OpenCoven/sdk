# @opencoven/cave-client

A constrained Cave health client. Consumers provide the transport; this package
does not discover endpoints or credentials, and health checks reject malformed
responses or incompatible minimum client versions deterministically.
