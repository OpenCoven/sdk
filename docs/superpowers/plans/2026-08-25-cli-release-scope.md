# SDK CLI 0.1 Release-Scope Decision

**Status:** Implementation and canonical verification complete; review and merge pending

**Date:** 2026-08-25

**Issue:** [OpenCoven/sdk#37](https://github.com/OpenCoven/sdk/issues/37)

**Bead:** `sdk-cli-scope`

## Decision

`@opencoven/dev-cli` remains a private workspace package and is excluded from
the SDK 0.1 public release. The public fixed-version group contains:

1. `@opencoven/sdk-core`
2. `@opencoven/cave-client`
3. `@opencoven/coven-client`
4. `@opencoven/sdk`

The CLI implementation remains source-tested so its command grammar, stable
human/JSON output, native keyring integration, import purity, and fail-closed
trust boundaries do not regress.

## Rationale

The CLI has a substantive read-only command implementation, but its default
runtime cannot prove all production native trust requirements:

- Windows Cave discovery requires a reviewed path ownership and ACL validator.
- Coven health requires a reviewed Unix connected-peer identity or Windows
  pipe ownership/identity provider.
- The native `coven daemon status --json` command does not expose the SDK
  capability and compatibility contract and is therefore not a safe drop-in
  adapter.

Publishing a global binary that fails its primary commands on supported
platforms would create a misleading release contract. Shipping weaker
pathname, process, or shell-based trust would violate the approved security
model.

## Ownership boundary

OpenCoven Chat's Tauri layer owns the Phase 1 production native adapters and
passes them to the packed SDK libraries. The webview never receives Cave
bearers or native trust handles.

A future standalone CLI release requires a separate reviewed design for native
adapter ownership, supported operating systems and architectures, package
distribution, signing, updates, and packed-binary real-authority tests.

## Implementation

- [x] Add separate `WORKSPACE_PACKAGES` and `PUBLIC_PACKAGES` inventories.
- [x] Keep all five packages under workspace manifest and source tests.
- [x] Restrict release configuration and Changesets fixed versions to four
  public packages.
- [x] Restrict package builds, tarballs, manifests, publication, and isolated
  packed consumers to the four public packages.
- [x] Remove packed CLI and native-keyring assertions from the public release
  verifier while retaining source CLI and keyring tests.
- [x] Update active release, roadmap, root, package, and historical-scope docs.
- [x] Run focused and full canonical verification.
- [ ] Complete exact-head review and address findings.
- [ ] Merge through protected review and verify `main`.
- [ ] Update GitHub issues and Bead evidence, archive the reviewed head, and
  retire the worktree.

## Verification contract

The change is complete only when:

- release configuration contains exactly four packages in canonical order;
- Changesets fixes exactly those four packages;
- release artifacts contain exactly four checksummed tarballs;
- isolated packed consumers install and import only those four packages;
- the private CLI remains import-pure and its command, native keyring, and
  fail-closed security tests pass from source;
- `corepack pnpm@10.34.0 verify` passes at the reviewed commit;
- required pull-request and post-merge checks pass.
