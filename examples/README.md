# OpenCoven SDK examples

These examples use deterministic caller-supplied transports. They perform no
endpoint discovery, credential lookup, or network access.

Build the workspace, then run each example:

```bash
corepack pnpm@10.34.0 build
corepack pnpm@10.34.0 --filter @opencoven/example-cave-health start
corepack pnpm@10.34.0 --filter @opencoven/example-coven-health start
corepack pnpm@10.34.0 --filter @opencoven/example-unified-health start
```

The package verifier also installs the public package tarballs into isolated
copies of these examples, compiles them, and executes them:

```bash
corepack pnpm@10.34.0 verify:package
```
