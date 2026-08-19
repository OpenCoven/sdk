# Support policy

## Supported runtime

The SDK supports Node.js 24 with the exact engine range `>=24.18.0 <25`.
Continuous integration verifies the minimum supported release and the latest
available Node.js 24 minor. Node.js 22, Node.js 26, browsers, and alternative
JavaScript runtimes are not supported.

Before 1.0, only the latest minor release line receives fixes. Users should
upgrade before requesting support for an older pre-1.0 minor.

## Requesting help

Open a GitHub issue for non-sensitive defects. Include:

- a minimal reproduction;
- the affected package and exact version;
- the exact Node.js version;
- sanitized diagnostics and observed/expected behavior.

Do not include credentials, tokens, private endpoints, payloads, or raw error
causes. The project is community maintained and provides no service-level agreement,
guaranteed response time, or guaranteed resolution time.

## Scope

Support covers the documented SDK APIs and package artifacts. Endpoint
discovery, application transport retries, persistent credential storage,
network policy, and third-party transport behavior remain the application's
responsibility.

Security reports must follow [SECURITY.md](SECURITY.md), not the public issue
tracker.
