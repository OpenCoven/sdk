# SDK 0.1.0 no-publish rehearsal runbook and authorization-gated continuation

**Status: PREPARED — NOTHING IN THIS RUNBOOK HAS BEEN EXECUTED EXTERNALLY.**
No `sdk-v0.1.0` tag exists, no release workflow has been dispatched, and no
registry mutation has occurred. Every step below that touches anything
external is behind an explicit authorization stop.

This runbook is the operator procedure for issue
[OpenCoven/sdk#41](https://github.com/OpenCoven/sdk/issues/41) rehearsal steps
(issue sequence step 4) and documents the post-authorization continuation
(steps 5–7). The release decision is recorded, **pending fresh maintainer
authorization**, in the [0.1.0 release authorization record](../release/sdk-0.1.0-release-authorization-record.md).
Read that record first; this runbook assumes its launch criteria.

The two-key system is authoritative: the reviewed unlock change opens the
repository lock (`publishingEnabled: true`, four publishable manifests); the
protected `npm-release` environment approval remains the independent second
key, reachable only through `.github/workflows/release.yml`.

## 0. Constants

| Constant | Value |
|---|---|
| Fixed-group version | `0.1.0` |
| Tag | `sdk-v0.1.0` (annotated, `tagPrefix` from `release.config.json`) |
| Packages, canonical publish order | `@opencoven/sdk-core` → `@opencoven/cave-client` → `@opencoven/coven-client` → `@opencoven/sdk` |
| Excluded | `@opencoven/dev-cli` (deferred from 0.1; never packed, published, attested, or trusted-publisher-configured) |
| Release workflow | `.github/workflows/release.yml` on `OpenCoven/sdk`, `workflow_dispatch` with `mode` (`verify` / `publish`) and `version` |
| Artifact name | `opencoven-sdk-0.1.0` (immutable workflow artifact: 4 tarballs + `release-manifest.json`) |
| Registry | `registry.npmjs.org`, access `public`, dist-tag `latest` |

## 1. Local dry-run evidence (executed during preparation — non-mutating)

Executed on the stacked branch at the review head with Node `v24.18.1` /
pnpm `10.34.0`, output to throwaway temp directories only:

- `corepack pnpm@10.34.0 verify:release` → exit 0, summary
  `{"version":"0.1.0","publishingEnabled":true,"packages":["@opencoven/sdk-core","@opencoven/cave-client","@opencoven/coven-client","@opencoven/sdk"]}`.
- `corepack pnpm@10.34.0 release:artifacts -- --output <tmp>/artifacts --version 0.1.0 --skip-build`
  → exit 0; four tarballs + manifest (digests in §4). Re-run into a second
  temp dir produced a **byte-identical manifest** — pnpm pack normalizes tar
  entry metadata (fixed epoch, uid/gid 0), so artifact digests are
  reproducible across checkouts and the digest comparison in §5.6 is exact.
- `corepack pnpm@10.34.0 pack:public --skip-build --json-file <tmp>/pack-public.json`
  → exit 0; four tarballs in an owned temp root (note: unlike
  `release:artifacts`, this script does not accept a leading `--` separator).
- Registry-unchanged proof: `npm view <name> version` for all four package
  names → `E404` (exit 1) each, on 2026-08-30. No registry state exists.

No tag was created, no workflow was dispatched, no registry mutation occurred.

## 2. Rehearsal procedure (issue step 4) — each external action gated

### 2.0 Authorization stop A — tag creation

Requires fresh maintainer authorization in #41 naming the tag `sdk-v0.1.0`
and the exact commit. Then, from a clean checkout of the reviewed release
commit on `main` (after the unlock PR has merged upstream):

```bash
corepack pnpm@10.34.0 install --frozen-lockfile
corepack pnpm@10.34.0 verify          # must exit 0
git diff --exit-code                  # clean tree
git tag -a sdk-v0.1.0 -m "OpenCoven SDK 0.1.0 first public release" <reviewed-release-commit-sha>
git push origin sdk-v0.1.0
node ./scripts/verify-release-readiness.mjs --version 0.1.0 --tag sdk-v0.1.0 --require-tag
```

The workflow itself re-validates that the tag resolves to the exact checked-out
`HEAD` (`scripts/release-readiness.mjs`, `--require-tag`), so a tag pointing
anywhere else fails closed.

### 2.1 Authorization stop B — verify-mode dispatch

Requires fresh maintainer authorization naming verify mode. Dispatch from
`main` only (the preflight job refuses any other ref):

```
POST /repos/OpenCoven/sdk/actions/workflows/release.yml/dispatches
{"ref":"main","inputs":{"mode":"verify","version":"0.1.0"}}
```

The `verify` mode job: canonical `corepack pnpm@10.34.0 verify`, tag-on-HEAD
validation, clean-tree check, artifact creation, upload of the immutable
`opencoven-sdk-0.1.0` artifact. Verify mode **never publishes** — the publish
job is skipped unless `mode == 'publish'`.

### 2.2 Registry-unchanged proof

Immediately before and after the verify run:

```bash
npm view @opencoven/sdk-core version     # expect E404
npm view @opencoven/cave-client version  # expect E404
npm view @opencoven/coven-client version # expect E404
npm view @opencoven/sdk version          # expect E404
```

Record the four E404 results (with timestamps) in #41. Any registry hit is a
halt condition and an incident.

### 2.3 Artifact retention

Download the workflow artifact `opencoven-sdk-0.1.0`: four tarballs plus
`release-manifest.json` (which carries name, version, byte size, and SHA-256
per tarball). Retention notes:

- The workflow sets `retention-days: 7`; extend or re-upload retention per the
  maintainer's approved count (issue language: "five-or-approved-count
  tarballs" — the canonical system produces **four** package tarballs plus the
  manifest; the authorization record §3.6 asks the maintainer to confirm the
  approved count).
- Build **attestations** are produced only on the publish path
  (`actions/attest-build-provenance` in the `publish` job); verify mode has no
  attestation step. The rehearsal record therefore consists of the artifact
  bundle + digests; attestation evidence arrives with the post-authorization
  steps below.

### 2.4 Digest comparison with the reviewed candidate

The reviewed candidate is the manifest recorded in §4 (generated by
`release:artifacts` at the reviewed commit). Re-generate it at the final
reviewed commit before tagging and confirm the four digests still match
(docs-only deltas do not enter packed tarballs, but confirm anyway). Then:

1. Compare the downloaded workflow artifact's `release-manifest.json`
   byte-for-byte with §4.
2. Independently re-compute `sha256sum` of each downloaded tarball and compare
   with the manifest entries.

Any mismatch is a halt condition: do not proceed toward publish; investigate
the delta between the tagged commit and the reviewed candidate.

## 3. Post-authorization continuation (issue steps 5–7)

Each subsection starts at its own authorization stop. Execute in order; a
failure at any step halts the sequence until dispositioned.

### 3.1 Step 5 — one-time bootstrap publish (Authorization stop C)

Requires: maintainer authorization naming the bootstrap owner; the bootstrap
owner named in #41; launch criteria from the authorization record confirmed
(including F-1 resolution or formal waiver and registry E404 re-proof).

1. Obtain a least-privilege npm **automation** credential protected by the
   account 2FA, scoped to the new packages only. **Never** place it in
   repository files, GitHub secrets for future use, workflow logs, argv, or
   shell history — supply it interactively or via a prompt-reading mechanism;
   `revoke-after-use` is the maintainer's duty (record the revocation
   timestamp in #41).
2. Publish the **exact reviewed tarballs** from the rehearsal artifact bundle
   in canonical order, without rebuilding (the bytes must be the digest-matched
   set from §2.4):

   ```bash
   npm publish tarballs/core/opencoven-sdk-core-0.1.0.tgz  --access public --tag latest
   npm publish tarballs/cave/opencoven-cave-client-0.1.0.tgz --access public --tag latest
   npm publish tarballs/coven/opencoven-coven-client-0.1.0.tgz --access public --tag latest
   npm publish tarballs/sdk/opencoven-sdk-0.1.0.tgz --access public --tag latest
   ```

   (Bootstrap publishes without provenance — npm trusted publishing cannot be
   configured before the packages exist; provenance arrives with step 3.2's
   OIDC path. This two-phase design is RELEASING.md §6–7.)
3. Acceptance checks: `npm owner ls <pkg>` shows the expected org ownership ×4;
   `npm view <pkg>` name/version/contents match the reviewed manifests; the
   four `latest` dist-tags equal `0.1.0`.
4. Revoke the bootstrap credential immediately; preserve the audit trail
   (command transcript without any secret material, credential id, revocation
   proof) in #41.

### 3.2 Step 6 — trusted publishing (Authorization stop D)

Requires: maintainer authorization for trusted-publisher configuration.

For each of the four packages, configure npm trusted publishing to:
repository `OpenCoven/sdk`, workflow `.github/workflows/release.yml`,
GitHub environment `npm-release`. Acceptance: all four packages report the
expected trusted-publisher identity; normal publication uses OIDC only
(`id-token: write` + `--provenance`) with **no** `NPM_TOKEN`/`NODE_AUTH_TOKEN`
fallback (the publish script rejects tokens by construction, and no such
secret may be created).

### 3.3 Step 7 — registry/provenance validation (Authorization stop E)

Requires: maintainer authorization to run the validation sequence (read-only
except any corrective action).

- Versions and `latest` dist-tags = `0.1.0` ×4.
- Registry manifests: names, `AGPL-3.0-only OR MIT` license, changelogs,
  export maps, dependency ranges (exact `0.1.0` internal ranges), engines
  `>=24.18.0 <25`.
- Registry tarball SHA-256 values match the reviewed `release-manifest.json`.
- npm provenance and GitHub build attestations present and bound to
  `OpenCoven/sdk` + `release.yml` + `npm-release`.
- Clean consumer validation: blank-consumer `npm install` of the four
  published packages, ESM and type imports of every public entrypoint
  (the packed-consumer fixtures in `scripts/verify-package.mjs` define the
  expected surface). The global CLI check is **not applicable** —
  `@opencoven/dev-cli` is deferred from 0.1.
- Record the workflow run, commit, tag, manifest, attestations, and results in
  the release notes and #41; link evidence from #31 (which closes only after
  validation evidence is linked).

## 4. Reviewed candidate artifact digests

Generated by `corepack pnpm@10.34.0 release:artifacts -- --output <tmp>
--version 0.1.0 --skip-build` at the review head of the stacked unlock branch
(docs-only commits after this point do not affect packed bytes; re-run at the
final reviewed commit to confirm equality before tagging):

```json
{
  "schemaVersion": 1,
  "version": "0.1.0",
  "packages": [
    {
      "name": "@opencoven/sdk-core",
      "version": "0.1.0",
      "file": "tarballs/core/opencoven-sdk-core-0.1.0.tgz",
      "size": 33431,
      "sha256": "99e1daec61c53cf9ff2dc05cc359dc6d26eb44568488518eedbe12a6950d0aa5"
    },
    {
      "name": "@opencoven/cave-client",
      "version": "0.1.0",
      "file": "tarballs/cave/opencoven-cave-client-0.1.0.tgz",
      "size": 81625,
      "sha256": "541e0f497a168c843f9a15aff716cb88709556c2cda6cf3a19502519fb4ce5c1"
    },
    {
      "name": "@opencoven/coven-client",
      "version": "0.1.0",
      "file": "tarballs/coven/opencoven-coven-client-0.1.0.tgz",
      "size": 33005,
      "sha256": "2b2a0ea92924199f32c9950ae361b66f0eab0db7d368e2d22cfb3d8cfc6799fa"
    },
    {
      "name": "@opencoven/sdk",
      "version": "0.1.0",
      "file": "tarballs/sdk/opencoven-sdk-0.1.0.tgz",
      "size": 15817,
      "sha256": "eb869de25003f4c6143b925915de4c09ab21cb7beb02f191c0e85c60cb702124"
    }
  ]
}
```

## 5. Master authorization sentence

When a maintainer authorizes the full sequence, the single sentence to record
in #41 is:

> Authorized for OpenCoven/sdk#41: execute the SDK 0.1.0 first-public-release
> sequence exactly as written in
> `docs/workflows/first-release-rehearsal-runbook.md` — annotate and push tag
> `sdk-v0.1.0` at the reviewed commit, run the release workflow in verify
> mode, complete the one-time bootstrap publish with a named least-privilege
> credential revoked after use, configure npm trusted publishing for the four
> packages to `OpenCoven/sdk` + `release.yml` + the protected `npm-release`
> environment, and run registry/provenance validation — with the launch
> criteria confirmed and each step's stop re-confirmed.

Absent that sentence (or an equally explicit one scoped to a specific step),
nothing in §2–§3 may be executed.

## 6. Rollback and incident references

npm versions are immutable; rollback follows RELEASING.md §10 (deprecate,
dist-tag move only after review, corrective release) and §11 (suspend the
`npm-release` environment, revoke credentials, preserve evidence, advisory,
postmortem before restoring publication). The rollback owner proposal and its
required confirmation are in the authorization record §1 and §3.7.
