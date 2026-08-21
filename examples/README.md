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

## Examples versus scaffolds

These examples live in the workspace and exist to be verified. To start your own
package, generate a scaffold instead:

```bash
opencoven scaffold unified-status ./my-status
```

Scaffolds are self-contained: their own manifest, their own `tsconfig.json`, and
a README covering installation from packed tarballs. The same verifier compiles
and runs every scaffold against the tarballs it just packed.

A browser cannot connect to Cave or Coven directly in v1. Run an example or a
scaffold in a server-side runtime you control and let the browser talk to that.
