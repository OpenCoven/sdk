# OpenCoven SDK examples

These examples perform no external network access. `cave-discovery` creates a
temporary owner-local Client v1 record and injects its health response on Unix;
Windows runs require a reviewed native filesystem trust provider and report a
skip. The other examples use deterministic caller-supplied transports.

Build the workspace, then run each example:

```bash
corepack pnpm@10.34.0 build
corepack pnpm@10.34.0 --filter @opencoven/example-cave-discovery start
corepack pnpm@10.34.0 --filter @opencoven/example-cave-health start
corepack pnpm@10.34.0 --filter @opencoven/example-coven-health start
corepack pnpm@10.34.0 --filter @opencoven/example-unified-health start
```

The package verifier also installs the public package tarballs into isolated
copies of these examples, compiles them, and executes them:

```bash
corepack pnpm@10.34.0 verify:package
```
