# Support policy

## Supported runtime

The SDK supports Node.js 24 with the exact engine range `>=24.18.0 <25`.
Continuous integration verifies the minimum supported release and the latest
available Node.js 24 minor. Node.js 22, Node.js 26, browsers, and alternative
JavaScript runtimes are not supported.

Before 1.0, only the latest minor release line receives fixes. Users should
upgrade before requesting support for an older pre-1.0 minor.

## 0.1 native conformance release matrix

The published TypeScript packages keep the Node runtime support above. That
runtime policy does **not** mean every operating system or architecture is
release-supported for the 0.1 native Chat/real-authority conformance journey.

For the 0.1 release gate, the only machine-validated native conformance matrix
is:

- `darwin-arm64` — macOS arm64
- `linux-x64` — Linux x86_64
- `win32-x64` — Windows x86_64

Targets outside that matrix are currently unproven for the 0.1 native consumer
journey. They are not automatically declared technically incompatible with the
published packages, but they are not release-supported conformance targets for
0.1.

Required native trust and credential-custody properties stay stable at the
concept level:

- `darwin-arm64` requires native keychain custody and live Unix connected-peer
  identity.
- `linux-x64` requires native keyring custody and live Unix connected-peer
  identity.
- `win32-x64` requires native credential custody plus named-pipe ownership and
  connected identity.

If the required native backend is missing, unavailable, or cannot prove these
properties, native conformance fails closed.

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
