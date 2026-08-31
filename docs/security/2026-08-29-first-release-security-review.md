# First-Release Security Review (SDK 0.1.0)

**Status:** Complete — recommendation recorded (see [Ship/block recommendation](#shipblock-recommendation))

**Date:** 2026-08-29

**Issue:** [OpenCoven/sdk#40](https://github.com/OpenCoven/sdk/issues/40) (parent [OpenCoven/sdk#31](https://github.com/OpenCoven/sdk/issues/31))

## Reviewed artifact

- Reviewed commit: `4736bf2e0d5b16272d79ecf7784c75f376b39b94` (origin/main HEAD at
  the time of review; subject `test(conformance): add cross-repository evidence
  contract (#73)`).
- Fixed 0.1 release group, all at `0.1.0`, all `private: true`:
  `@opencoven/sdk-core`, `@opencoven/cave-client`, `@opencoven/coven-client`,
  `@opencoven/sdk` (`packages/*/package.json`; enforced by
  `scripts/release-readiness.mjs:268-277`).
- Private and excluded from release: `@opencoven/dev-cli`
  (`packages/cli/package.json`; per `RELEASING.md` and
  `docs/superpowers/plans/2026-08-25-cli-release-scope.md`).
- Supported Node runtime: `>=24.18.0 <25` (`.node-version` = `24.18.1`;
  `release.config.json` `supportedNode`).
- Supported native-conformance platforms (release gate matrix):
  `darwin-arm64`, `linux-x64`, `win32-x64` (`release.config.json`
  `nativeConformancePlatforms`; enforced verbatim by
  `scripts/release-readiness.mjs:20-24,102-112`). This matrix gates the
  conformance record and is not the published package runtime support matrix.

## Threat boundaries and trust assumptions

Four boundaries were reviewed against the actual code and workflow files. The
local user is trusted; every other actor (other local users, remote Cave
authorities, remote proxies, package dependencies, workflow callers) is not.

1. **Cave boundary** — the SDK talks to a loopback-discovered Cave authority
   over HTTP. Trust assumption: only a Cave instance owned by the current user,
   advertising a loopback URL, with a live owner process, may be used.
2. **Coven boundary** — the SDK discovers and connects to an owner-local Coven
   daemon over a Unix socket or Windows named pipe. Trust assumption: the
   endpoint must be owned by the current user, must not be a symlink, must not
   be writable by others, and the connected peer must be the current user.
3. **Native/CLI boundary** — `@opencoven/dev-cli` (private) integrates native
   keychain storage and shells out only to the trusted Coven executable for
   discovery. Trust assumption: native modules and the Coven executable are
   resolved through fail-closed trust checks, never from untrusted paths.
4. **Release/supply-chain boundary** — publication happens only through the
   `release.yml` workflow. Trust assumption: no publication may occur through a
   token fallback or an unprotected path while `publishingEnabled` is `false`;
   workflow actions must be SHA-pinned with least-privilege permissions.

## Automated evidence

All commands were run on the reviewed commit in a clean worktree
(`/home/node/coven-sdk/wt-40`) with Node `v24.18.1` and pnpm `10.34.0`
(Engine requirement `>=24.18.0 <25` is enforced by `.npmrc`
`engine-strict=true`; the review host's default Node `v24.16.0` cannot run the
gate, so the gate was executed under the same Node version upstream CI uses).
No publish, tag, unlock, or workflow dispatch was performed.

- Canonical gate `corepack pnpm@10.34.0 verify`: **exit 0**. Sequence:
  typecheck → clean public dist → test (**58 test files, 1213 tests, all
  passed**) → `verify:contracts` → `verify:package` → `verify:release` →
  coverage (statements 90.11%, branches 85.7%, functions 96.53%, lines 90.37%)
  → operation-property stress suite → lint (`--max-warnings=0`).
- Release readiness `node ./scripts/verify-release-readiness.mjs`: exit 0,
  output `{"version":"0.1.0","publishingEnabled":false,"packages":["@opencoven/sdk-core","@opencoven/cave-client","@opencoven/coven-client","@opencoven/sdk"]}`.
- Dependency audit `corepack pnpm@10.34.0 audit`: **"No known vulnerabilities
  found"**, exit 0 (registry audit endpoint reachable at review time).
- Public API baseline: `tests/api-baselines.spec.ts` (8 tests) passed inside
  `verify`; `api-baselines/sdk.json` pins the packed runtime exports of
  `@opencoven/sdk` to exactly `OpenCovenSdk`, `OpenCovenSdkError`,
  `createOpenCovenSdk`.
- Packed consumer result: `corepack pnpm@10.34.0 pack:public` produced exactly
  four tarballs (private CLI excluded). Tarball contents are dist, fixtures,
  and metadata only (no source tree, no native binaries, no install lifecycle
  scripts — packed manifests carry only `build`/`typecheck` scripts, which do
  not execute on install). Installing the four tarballs offline into a
  throwaway directory via `file:` overrides succeeded, and
  `import('@opencoven/sdk')` plus `import('@opencoven/cave-client')` resolved
  and exposed the expected exports (`createCaveClient` present).
- Secret/history scan: full `git log -p --all` (267 commits) grep for
  high-entropy credential shapes (`ghp_`, `gho_`, `github_pat_`, `sk-`,
  `AKIA`, `xox[baprs]-`, PEM private keys, `npm_` tokens): **no matches**. A
  follow-up assignment-pattern scan (`token|secret|bearer|password` followed by
  `=`/`:` and a literal) returned only synthetic test constants
  (`'AAAA…'`, `'BBBB…'`, `'CCCC…'`, `'abcdefghijklmnop'`) used by redaction and
  contract tests. No real credential appears in history.

Evidence limitation: the audit result is a point-in-time statement against the
lockfile at the reviewed commit and does not by itself cover future advisory
disclosures.

## Boundary findings

### Cave boundary — no finding

- Endpoint admission is loopback-only and path-free:
  `packages/cave/src/discovery-record.ts:123-126,147-151` rejects non-loopback
  hosts; `packages/core/src/discovery.ts:189-225` additionally rejects DNS
  names and accepts IP loopback only.
- Discovery-record parsing is allowlisted to exact fields
  (`packages/cave/src/discovery-record.ts:326-332`), requires a positive safe
  integer pid, and treats a dead pid as a stale record
  (`discovery-record.ts:344-351`; liveness check includes `EPERM` = alive,
  `packages/cave/src/discovery.ts:549-556`). Record reads enforce byte caps and
  deadlines (`packages/cave/src/discovery.ts:541-545`).
- The HPKE authority key is bound to a derived key id at parse time
  (`packages/cave/src/discovery-record-node.ts:20-29`), and secret comparison
  is constant-time (`packages/cave/src/hpke-bound-v1.ts:411`) with
  CSPRNG-generated key material (`hpke-bound-v1.ts:513`).
- Proxy responses cannot masquerade as authority envelopes: every response is
  parsed against the strict Client v1 envelope schema first
  (`packages/cave/src/pairing.ts:284-309`), so proxy rejection bodies fail
  envelope parsing with typed errors instead of being trusted.
- Wrong-scope/revoked credentials: stored-credential loading distinguishes
  `invalid_bearer` and `invalid` states and invalidates the stored record when
  the authority binding no longer verifies
  (`packages/cave/src/credential-binding.ts:75-87,765-779`).
- Pagination is bounded: default limit 50, max limit 100, max cursor length
  512 (`packages/core/src/pagination.ts:15-17`), malformed/non-canonical
  cursors are rejected (`pagination.ts:135-145`).
- Compatibility negotiation requires strict SemVer and compares the client
  version against the advertised minimum
  (`packages/core/src/compatibility.ts:42-43,191-209`).

### Coven boundary — no finding

- A trusted Coven executable resolver is mandatory and fail-closed:
  discovery throws without one (`packages/coven/src/discovery.ts:943-950`) and
  executable/daemon-metadata owner trust failures abort discovery
  (`discovery.ts:607-620,693-698`). The discovery subprocess is bounded (2 s
  timeout, 64 KiB output cap; `discovery.ts:21-22,1446-1447`), and daemon
  status reads are capped at 16 KiB (`discovery.ts:23,753-825`).
- Unix socket admission validates owner uid, rejects symlinks, non-sockets,
  and group/other-writable modes via `lstat`
  (`packages/coven/src/transport-unix.ts:1198-1221`), then revalidates after
  connect: the connected peer's uid must equal the current user with strict
  descriptor hygiene (extra/foreign own-properties rejected,
  `transport-unix.ts:1223-1282`), and the path identity (device, inode, mode,
  owner, symlink, socket bits) must be unchanged between pre- and post-connect
  inspections, closing the replace race (`transport-unix.ts:1374-1409`,
  identity comparison `1284-1296`). Connected-peer inspection is mandatory — a
  transport without it is refused (`transport-unix.ts:1307-1316`).
- Windows named-pipe admission requires owner identity, `ownerOnly` ACL state,
  and pipe/server/process identity strings, and fails closed when any are
  missing or when the owner is not the current user
  (`packages/coven/src/transport-windows.ts:104-125`).
- Structured daemon errors are preserved through typed IPC errors rather than
  flattened (error phases `validate_endpoint` / `revalidate_endpoint` carried
  on every failure above), with fixtures under `packages/coven` asserting the
  preserved shape.

### Native/CLI boundary — no finding

- The native keychain adapter is loaded through an injectable loader with a
  probe account, service naming, and a lock protocol with stale-lock takeover
  (`packages/cli/src/native-secret-store.ts`: `NATIVE_SECRET_STORE_PROBE_ACCOUNT`,
  `NATIVE_SECRET_STORE_LOCK_*` constants); unavailability surfaces as typed
  `secure_store_unavailable` / `secret_store_*` diagnostics instead of secrets
  falling back to disk.
- CLI argument handling is fixed-argv: `packages/cli/src/bin.ts:5` passes
  `process.argv.slice(2)` and `packages/cli/src/main.ts:235-241` parses an
  allowlist of flags; no shell is spawned anywhere in the CLI source.
- Human/JSON/NDJSON output is filtered through a sensitive-key redaction
  pattern covering `authorization`, `bearer`, `cookie`, `pairing secret`,
  `password`, `secret`, `token`, and `stack`
  (`packages/cli/src/output.ts:1`).
- No native binaries ship: the four public package manifests declare no
  `os`/`cpu`/`optionalDependencies` native artifacts; runtime dependencies are
  exactly pinned (`@hpke/core` 1.9.0, `@hpke/dhkem-x25519` 1.8.0,
  `canonicalize` 3.0.0), with root pnpm overrides freezing `@hpke/common`
  1.10.0 and `esbuild` 0.28.1 (`package.json` `pnpm.overrides`). Platform
  coverage for the native trust path is exercised by the #38 conformance
  matrix (see finding F-1).

### Release/supply-chain boundary — no finding on the reviewed commit

- Every `uses:` in `.github/workflows/ci.yml` (lines 25-32) and
  `.github/workflows/release.yml` (lines 32-114) is pinned to a full commit
  SHA with the version recorded in a comment. Workflow-level permissions are
  least-privilege `contents: read` (`ci.yml:9-10`, `release.yml:18-19`).
- The publish job is the only elevated job: `environment: npm-release` with
  `contents: read`, `id-token: write`, `attestations: write`
  (`release.yml:82-88`), it runs only from `main` (`release.yml:42-46`) after
  a full `verify` and a clean-tree check (`release.yml:49-63`), and it
  re-validates publication gates before publishing (`release.yml:107-113`).
- Publication requires two independent locks
  (`RELEASING.md` §1): (1) a reviewed repository change flipping
  `publishingEnabled` to `true` and unprivatizing the four manifests, and (2)
  approval of the protected GitHub environment `npm-release`. Both locks are
  currently closed, and `verify:release` reports
  `"publishingEnabled":false`.
- Checksums are computed at artifact creation
  (`scripts/create-release-artifacts.mjs:25-26,140`) and re-verified byte-for-
  byte against the manifest before any publish
  (`create-release-artifacts.mjs:210-233`). npm publication uses OIDC trusted
  publishing with `--provenance` (`scripts/publish-release-artifacts.mjs:26-34`)
  rather than registry tokens.

## Release-workflow negative review

Proven by inspection and by executing only non-publishing verification:

1. `verify-release-readiness --mode publish` fails closed while
   `publishingEnabled` is `false`
   (`scripts/release-readiness.mjs:303-305`). Executed: exit 1, message
   `Release publishing is disabled by release.config.json`.
2. The publish script re-runs the readiness check in `publish` mode before
   anything else (`scripts/publish-release-artifacts.mjs:44-48`), so with the
   current config every path into `npm publish` exits before any
   authorization, artifact, or network step. Executed: exit 1 with the same
   message, with and without an authorization env var present, and with a
   placeholder npm token value exported (no publish was attempted; no network
   call occurred).
3. Token fallback is forbidden by construction, not just by current config:
   the publish script throws when `NPM_TOKEN` or `NODE_AUTH_TOKEN` is present
   in the environment (`publish-release-artifacts.mjs:58-62`), so when
   publication is eventually enabled it can only proceed through the workflow's
   OIDC identity (`id-token: write` + `--provenance`), never a long-lived
   token.
4. There is no unprotected path: the only artifact-publishing job is gated on
   `inputs.mode == 'publish'` (`release.yml:78`), `needs: preflight`
   (`release.yml:79`), the protected `npm-release` environment
   (`release.yml:82`), and the readiness gate (`release.yml:107-113`). The
   readiness validator additionally enforces that the publish job keeps its
   environment and permission block (`release-readiness.mjs:128-172`,
   including the slicing fix at `144-154` so a later job cannot satisfy the
   requirement).
5. Note recorded for precision: `OPENCOVEN_RELEASE_AUTHORIZATION=publish` is
   set inline by the workflow step itself (`release.yml:119-120`), so it is an
   in-workflow invariant rather than an independent human control. This is
   finding F-3 below; the independent controls remain `publishingEnabled`,
   manifest privacy, and environment approval.

## Diagnostics and retained evidence secret-safety

- CLI output redaction (`packages/cli/src/output.ts:1`) strips sensitive keys
  from human, JSON, and NDJSON output; profiles and diagnostics are explicitly
  non-secret (`RELEASING.md`, issue #39 scope; `packages/core/src/profiles.ts`
  uses UUID-suffixed temp files for atomic writes without storing secret
  material).
- Structured errors carry codes and phases, not raw causes: diagnostic ids in
  `packages/core/src/diagnostics.ts:83-86` are enumerated failure codes
  (`secret_store_read_failed` etc.), and the review verified by inspection that
  no pairing secret, bearer token, message body, or socket handle is included
  in retained fixtures (`packages/coven/fixtures/*.json`,
  `packages/cave/fixtures/contract-fixture*.json` contain only synthetic
  values).
- The retained cross-repository results directory states its own redaction
  contract (`docs/client-v1-cross-repository-results/README.md`: immutable,
  redacted aggregates only, no passing record yet).
- History scan (above) found no real credentials; retained test constants are
  synthetic.

## Findings register

Every finding carries severity, evidence, owner, and one of the three
dispositions. No other finding was identified in the four boundaries; the
absence statements above are each backed by named file/line evidence.

### F-1 — Missing #38 aggregate conformance record (inherited from #38)

- **Severity:** High
- **Disposition:** **blocks publication**
- **Evidence:**
  `docs/client-v1-cross-repository-results/README.md` — "There is no passing
  record yet"; `release.config.json` on the reviewed commit carries no
  aggregate-record binding; the #38 audit verdict (recorded by the program
  audit of OpenCoven/sdk#38) confirms every in-repo #38 criterion is enforced
  by PR [#74](https://github.com/OpenCoven/sdk/pull/74) (open and green at
  review time: `verify (24.18.1)`, `verify (24.x)`, CodeQL all SUCCESS),
  whose fail-closed gate (`conformanceEvidence.aggregateRecord: null` in its
  `release.config.json`; publish mode throws
  `release.config.json must name a passing SDK #38 aggregate record` when the
  record is absent) keeps publication closed until the record exists. Chat has
  not yet produced schema-v2 platform records on `darwin-arm64`,
  `linux-x64`, and `win32-x64`, so the named aggregate record cannot exist.
- **Owner:** OpenCoven/chat maintainers (platform records) with the SDK release
  maintainer (aggregate acceptance and config binding).
- **Unblock condition:** three passing platform records are produced, the
  SDK-side aggregator accepts them, the aggregate record is committed under
  `docs/client-v1-cross-repository-results/`, and
  `conformanceEvidence.aggregateRecord` is set through the PR #74 gate.
- **Follow-up date:** tracked by #38 / Chat#27; re-check at the next release
  candidate review.

### F-2 — Security policy promises no response-time or remediation SLA

- **Severity:** Low
- **Disposition:** **accepted** — owner: SDK maintainers; rationale: pre-1.0
  project with private vulnerability reporting enabled
  (`SECURITY.md:7-8`) and coordinated-disclosure assessment committed
  (`SECURITY.md:20-24`); an SLA promise made now could not be staffed
  credibly. Follow-up date: 2026-09-30, to revisit before the 1.0 line
  (`SECURITY.md` already scopes pre-1.0 fixes to the latest pre-1.0 minor).

### F-3 — Release-authorization env var is set by the workflow itself

- **Severity:** Low
- **Disposition:** **accepted** — owner: release maintainers; rationale:
  publication remains gated by two genuinely independent controls (the
  reviewed `publishingEnabled` flip plus protected-environment approval), so
  the env var is defense-in-depth inside the workflow rather than the gate;
  its invariant role ("must be publish") is still enforced by
  `scripts/require-release-authorization.mjs` and the publish script's own
  check (`publish-release-artifacts.mjs:55-57`). Follow-up date: with the
  merge of PR #74, whose environment-approval receipts
  (`protectedApproval` in its `release.config.json`, environment
  `npm-release`, admin reviewer binding) make the human approval step
  attestable.

## Ship/block recommendation

**Block publication** (block-until-records). The reviewed commit is approved as
the security basis for the 0.1.0 release with no unresolved in-repo finding:
all four boundaries verified clean with named evidence, the negative review
proves no token-fallback or unprotected publish path exists while
`publishingEnabled` is `false`, and diagnostics/retained evidence are
secret-safe. Publication must remain blocked solely by finding F-1 until the
named passing aggregate record (Chat schema-v2 on `darwin-arm64`,
`linux-x64`, `win32-x64` through the #38/PR #74 fail-closed gate) exists.
Once F-1 clears, no re-review of this commit's boundaries is required; only
the delta between this commit and the publication commit needs re-verification
by `verify` plus the readiness gate. This record must be linked from
OpenCoven/sdk#31.

Reproduction: check out `4736bf2e0d5b16272d79ecf7784c75f376b39b94`, run
`corepack pnpm@10.34.0 install --frozen-lockfile && corepack pnpm@10.34.0
verify` under Node `24.18.1`, then the audit, pack, and negative-gate commands
exactly as listed above; the dispositions above follow from those outputs and
the cited file/line evidence.
