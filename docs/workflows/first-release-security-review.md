# First-release security review

Tracking issue: [#40](https://github.com/OpenCoven/sdk/issues/40). Program issue: [#31](https://github.com/OpenCoven/sdk/issues/31).

**Disposition: BLOCK.** The frozen 0.0.1 candidate `96804bc4` predates two High-severity Cave fixes, so its packed bytes must not ship. See [Candidate re-review](#candidate-re-review-2026-09-25) and [Disposition](#disposition).

This document is the durable record required by #40. It does not authorize publication, create credentials, change branch protection, or waive a finding.

## Scope

| Field | Value |
|---|---|
| Reviewed revision | `aec069089` (main) |
| Prior checkpoint revisions | `3459dcaad`, `50e017578` |
| Frozen conformance candidate | `96804bc483a063e41e9a9738a4ace61970f6c0a4` |
| Runtime manifest SHA-256 | `8c46276b5698d32d570ad4a89998b412cb0efde5641313b0c71ae41519e64ae7` |
| Version under review | 0.0.1 |
| Minimum Node | 24.18.0 (major 24) |

Packages in the release set, all at 0.0.1 and all currently `private: true`:

- `@opencoven/sdk-core`
- `@opencoven/cave-client`
- `@opencoven/coven-client`
- `@opencoven/sdk`

`@opencoven/dev-cli` at 0.1.0 is outside the release set; its ship-or-defer record belongs to #37.

Platforms carried by native conformance: `darwin-arm64`, `linux-x64`, `win32-x64`.

## Threat boundaries

The 0.0.1 surface is read-only. It holds no mutation authority, so the boundaries below are about custody, transport, and disclosure rather than unintended writes.

1. **Credential custody.** Pairing secrets and bound credentials live in the OS keychain through the native trust adapter, never in repository state or plaintext caches. A spent single-use pairing secret must not be restorable. Reviewed in `packages/cave/src/pairing.ts` and `packages/cave/src/credential-binding*.ts`.
2. **Authority binding and downgrade.** HPKE-bound discovery (`hpke-bound-v1`) pins the authority a credential is bound to. A v2-to-v1 downgrade must fail closed. Reviewed in `packages/cave/src/hpke-bound-v1.ts` and `packages/cave/src/discovery*.ts`.
3. **Transport isolation.** Local transports are a Unix domain socket and a Windows named pipe, reached only by an owner-scoped path. Reviewed in `packages/coven/src/transport-unix.ts` and `transport-windows.ts`.
4. **Disclosure through diagnostics and errors.** Errors and diagnostics must not carry bearer material, paths, or untrusted upstream causes. Covered by `tests/diagnostics.spec.ts` and `tests/error-diagnostics.spec.ts`.
5. **Supply chain and publication path.** Released bytes must match reviewed bytes, and publication must be reachable only through the protected, attested OIDC path.
6. **Conformance harness isolation.** The harness must not reach the operator's real Cave, Coven, credentials, or projects. This is #38's criterion and is restated here because it bounds what retained evidence can contain.

Out of scope: the Cave and Coven servers themselves, the Chat producer, and any mutation authority (#42, #43).

## Automated results

Re-run at the reviewed revision `aec069089` on 2026-09-19. These are not carried forward from the prior checkpoint.

| Check | Result |
|---|---|
| Full test suite | 80 files, 2,678 passed, 2 skipped |
| `tsc --noEmit` | clean |
| ESLint `--max-warnings=0` | clean |
| `pnpm audit --audit-level low` | no known vulnerabilities |
| GitHub Actions `uses:` pinning | every entry pinned to a 40-character commit SHA |
| Token material in `release.yml` | no `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or `secrets.*` reference |
| Secret-shaped strings in tracked source | none |
| CodeQL (actions, javascript-typescript) | passing on main |

## Manual review

Automation does not cover these, so each was read directly.

1. **Publication path.** `release.yml` reaches npm only through `id-token: write` OIDC. The `publish` job is gated on `inputs.mode == 'publish'`, runs in the `npm-publish` environment, and depends on six preceding jobs including two attestation jobs and the approval-evidence chain. It checks out with `persist-credentials: false` and pins the Node runtime by SHA-256 before use. There is no token fallback branch to reach.
2. **Publishing interlock.** `release.config.json` sets `publishingEnabled: false`, and three scripts fail closed on it: `create-release-artifacts.mjs`, `github-release-authorization.mjs`, and `publish-release-artifacts.mjs`. Independently, all four release packages are `private: true`, so an accidental publish is refused by npm itself. Two independent interlocks.
3. **Trusted publisher binding.** `npmTrustedPublisher` names repository `OpenCoven/sdk`, workflow `release.yml`, environment `npm-publish`, and job `publish`. This must be confirmed against the registry at execution time; it cannot be verified from the repository alone.
4. **Single-use pairing semantics.** Reviewed the timeout and transport-failure branches in `pairing.ts` against each other. See F1.
5. **HPKE downgrade defense.** Reviewed the downgrade latch and its tests. No path accepts a v1 authority after a v2 authority has been observed.
6. **Retained evidence.** Conformance records are scanned for secrets and retained content by the validator; Linux and macOS records passed those scans on protected run `35146928092`.

## Findings

| ID | Severity | Area | Owner | Disposition | Follow-up due |
|---|---|---|---|---|---|
| F1 | Low | `packages/cave/src/pairing.ts` | SDK maintainer (@BunsDev) | **Fixed and verified** | None |
| F2 | Informational | `tests/windows-supervisor-source.spec.ts` | SDK maintainer (@BunsDev) | **Fixed and verified** | None |
| F3 | Informational | `tests/conformance-checkouts-publication.spec.ts` | SDK maintainer (@BunsDev) | **Accepted** | 2026-10-17, or the next occurrence, whichever comes first |

No critical or high findings. Both fixed findings are verified present in the reviewed source at `aec069089`. The one accepted finding carries an owner, a rationale, and a dated follow-up below; no finding is silently deferred.

### F1 — timed-out single-use pairing exchange advised retry

**Severity: Low. Disposition: fixed and verified.**

The timeout branch in `pairing.ts` reported `retryable: true` for a single-use pairing exchange, while the adjacent transport-failure branch already applied the single-use rule. A caller following that guidance would attempt to reuse a secret that may already have been spent.

Reachability is narrower than the finding first implied: `ensureActive(options.context)` runs immediately before the branch, so a deadline-driven timeout throws earlier and never reaches it. The branch is reached only when the fetch implementation itself raises a timeout while the operation context is still active. The defect and the inconsistency were real; the window is specific.

Repaired in [#294](https://github.com/OpenCoven/sdk/pull/294), merged at `50e017578`. The test was confirmed red before the fix (`expected retryable: false, received true`) and green after. This was also the first coverage of `pairingSecretDispatch` semantics, which was the coverage gap the finding named. Pre-existing bearer-protected timeout assertions still pass, confirming no over-correction.

### F2 — supervisor source suite exceeded its per-test budget

**Severity: Informational. Disposition: fixed and verified. No product defect.**

`renderWindowsSupervisorSource` gzips a 396 KiB source at level 9, and every `decodeWindowsSupervisorSource` call re-renders it to bind the decoder statements alongside the canonical gzip bytes. That re-render is the security property being tested. But the two tests together performed roughly seven full compressions inside vitest's default 5s per-test budget, measuring 1227ms locally and exceeding the budget on loaded parallel Windows runners.

Repaired in [#297](https://github.com/OpenCoven/sdk/pull/297), merged at `aec069089`, which is the reviewed revision, so the fix is present and verified in the reviewed source. It builds the shared canonical block and the bootstrap fixture once at module scope and setting the explicit 30s budget this repository already uses for fixture-heavy suites. The first test now measures 896ms. No assertion was removed or weakened, and two mutants confirm the suite still fails closed: deleting the re-render comparison, and disabling the source identity digest check, each turn the decoder-change test red.

**Follow-up:** none required; #297 is merged.

### F3 — checkout-state suite failed once under full-suite load

**Severity: Informational. Disposition: accepted. Owner: SDK maintainer (@BunsDev). Follow-up due 2026-10-17, or the next occurrence, whichever comes first.**

During this review, `tests/conformance-checkouts-publication.spec.ts > rejects staged, unstaged, hidden-index, and wrong-remote states` failed once in a full `npm test` run at 7168ms against the default five-second budget. It passed in isolation and passed in four subsequent full runs, including three at 2,678 passed with zero failures.

**Rationale for acceptance.** This is test infrastructure, not shipped source: the file is a `tests/` spec and appears in no package tarball, so it cannot affect a released artifact. The test asserts that `inspectRepositoryCheckout` *rejects* dirty and wrong-remote checkouts, so the guard it covers fails closed by construction; a flaky run produces a red build rather than a silently weakened check. The suite has a passing record of four full runs out of five at this revision, and CI additionally runs it in the frozen Node 24.18.1 `verify` job on Ubuntu. The moving Node 24.x compatibility job excludes conformance suites; the separate three-platform jobs exercise native keyring adapters.

**Why it is not fixed now.** The test spawns real `git` subprocesses to build fixture repositories, and subprocess contention is the plausible cause, but a single unreproduced failure does not establish one. The one observation captured a duration, not an assertion message. Changing the budget or serializing subprocesses on that evidence would be a guess, and would likely mask the signal needed to diagnose a genuine defect if one exists.

**Follow-up, owned and dated.** By 2026-10-17, or immediately on the next occurrence if sooner, the owner will either (a) capture the assertion text from a reproduction and land a targeted fix, or (b) record four further consecutive clean full runs and close the finding as non-reproducing. If the failure instead proves to be a real defect in `inspectRepositoryCheckout` rather than test timing, this finding is re-severitised and this document's disposition is recomputed before any ship decision.

**2026-09-20 follow-up.** Local full coverage for SDK #300 reproduced the
five-second deadline in six checkout cases, including the combined dirty-state
case. The captured failure was `Error: Test timed out in 5000ms.`, not a failed
checkout assertion. One separate conformance-artifact test also timed out.
The same exact PR head passed all 2,796 normal and coverage tests in the pinned
hosted verifier, with the timeout and checkout guards unchanged. This records
the recurrence and its error rather than closing the finding as non-reproducing.
The local scheduling cause remains unproven; any infrastructure change needs a
separate reproduction and review before the final release security disposition.

**This acceptance does not gate the disposition.** At `aec069089` the block was
structural. Since 2026-09-25 it rests on F4 and F5 (see
[Candidate re-review](#candidate-re-review-2026-09-25)); F3 is unrelated to
either.

## Candidate re-review, 2026-09-25

The reviews above were run against `main` (`aec069089`). The frozen
publication candidate is `96804bc483a063e41e9a9738a4ace61970f6c0a4`, cut on
2026-09-14. It is an **ancestor** of `aec069089`, not a descendant. This
re-review examined the candidate's exact packed bytes, not `main`.

### Evidence

- **Aggregate.** The first accepted three-platform aggregate exists for this candidate: [`96804bc4….json`](../client-v1-cross-repository-results/96804bc483a063e41e9a9738a4ace61970f6c0a4.json), from protected Chat [run 36113801474](https://github.com/OpenCoven/chat/actions/runs/36113801474), validator `185d6264` ([#318](https://github.com/OpenCoven/sdk/pull/318), [#319](https://github.com/OpenCoven/sdk/pull/319)).
  - `verify-committed-conformance-evidence.mjs` re-verified it live against GitHub.
  - Strict release readiness passes with it named.
  - #38's structural criterion is therefore met for this candidate.
- **Packed bytes.** The four tarballs consumed by Chat `ef8c747f` (`vendor/opencoven-sdk/*.tgz`) match the lock's candidate digests: `sdk-core` `5f41291d…`, `cave-client` `c4e44fb4…`, `coven-client` `bc24d3c1…`, `sdk` `5318c4c6…`. All four are `private: true` and declare no install or prepare lifecycle script.
- **Missing fixes.** `git merge-base --is-ancestor` shows that none of these fixes are in the candidate: [#277](https://github.com/OpenCoven/sdk/pull/277), [#285](https://github.com/OpenCoven/sdk/pull/285), [#294](https://github.com/OpenCoven/sdk/pull/294) and [#297](https://github.com/OpenCoven/sdk/pull/297). The candidate source and the packed `cave-client` `dist/` were read directly to confirm the consequences below.

### Findings against the candidate

| ID | Severity | Area | Owner | Disposition |
|---|---|---|---|---|
| F4 | High | `packages/cave/src/pairing.ts`: discovery-v2 downgrade latch absent | SDK maintainer (@BunsDev) | **Blocks publication of `96804bc4`**; fixed on `main` by #277 |
| F5 | High | `packages/cave/src/pairing.ts`: protected fetch error cause retained | SDK maintainer (@BunsDev) | **Blocks publication of `96804bc4`**; fixed on `main` by #285 |
| F1 | Low | `packages/cave/src/pairing.ts`: single-use timeout retry | SDK maintainer (@BunsDev) | Fixed on `main` by #294; **absent from `96804bc4`** |

**F4.** The candidate keeps no record that a client has observed a
discovery-v2 (`hpke-bound-v1`) authority. `observedV2` and
`assertProtectedAuthority` do not occur in the candidate source or in the
packed `cave-client` `dist/`. A later discovery that returns a v1 authority can
therefore receive protected pairing and bearer requests, which is the
downgrade that threat boundary 2 requires to fail closed. Manual review item 5
above was accurate for `main` and does not hold for the candidate.

**F5.** In the candidate, `requestJson` attaches the caller-supplied fetch
exception as `cause` unconditionally (`pairing.ts:929` at `96804bc4`). After an
HPKE-protected request is constructed, that exception can carry a bearer or
request metadata, which then reaches the public error cause chain in full-depth
inspection. This breaches threat boundary 4.

**F1.** The fix and its verification recorded above apply to `main` only. The
candidate does not contain #294.

`main` at `185d6264` contains all three fixes. The findings concern the frozen
candidate's bytes, not current source.

## Disposition

**BLOCK.**

The earlier structural block is lifted: a passing, attested, live-verified
three-platform aggregate now exists for the frozen candidate. The block now
rests on F4 and F5. Publishing `96804bc4` would ship a known downgrade path and
a known credential-disclosure path whose fixes are on `main`. No critical or
high finding may remain unresolved in shipped bytes, so this candidate cannot
be the 0.0.1 release.

The history below explains why the candidate took this long to evidence.

Historical protected evidence remains incomplete. Run
[35500732205](https://github.com/OpenCoven/chat/actions/runs/35500732205) used
Chat `ac1c4f4c` and SDK validator `1c10e63a`. Linux and macOS artifacts
independently passed exact identities, digests, canonical schema, privacy/isolation,
timing and all 197 ordered assertions each. Windows job `106052383153`
failed at `phase1.packaging.chat-native-build.build-script`, with no Windows
record. Validation, attestation, and aggregation were skipped. That historical
checkpoint was not a fresh security review of subsequent SDK features; the
exact candidate's review is the 2026-09-25 re-review above.

The earlier run `35146928092` independently passed 197 ordered assertions on
each Unix platform but failed the Windows checkout-quota monitor. Keep that
historical cause separate from the later Cargo build-script failure. Subsequent
producer diagnosis identified `aws-lc-sys` include paths exceeding `MAX_PATH`;
Chat #348 shortened the isolated bootstrap root.

Operational checkpoint, 2026-09-22: SDK #310 delivered the Chat #358 binding
at `1ad0dae0e09df37a42df11be5d0329ffc20f567e`, with both validator scopes
read back at that revision. Protected
[run 35704479061](https://github.com/OpenCoven/chat/actions/runs/35704479061)
completed with failure. Both Unix records passed the committed validators
and all 197 assertions each; the temporary macOS inspector's extra upload-step
timestamp guard refused, a discrepancy retained separately from committed
validation. Windows failed at
`phase1.stage.evidence-authority.build.failed` during schema-v2 evidence
assembly and uploaded no record. Validation, attestation and aggregation were
skipped. This checkpoint is not a new security review; no accepted aggregate
or publication approval is established.

Items 1 and 2 of the previous sequence are complete: the Windows evidence path
was repaired in Chat, and the aggregate above exists. Sequence to SHIP, in
order:

1. Freeze a new publication candidate from `main` that contains #277, #285 and
   #294. Regenerate its tarballs and runtime manifest.
2. Rebind the SDK conformance lock and Chat's vendored tarballs to that
   candidate, then obtain a fresh protected three-platform aggregate for it.
3. Re-review that candidate's exact packed bytes. Carry forward F3's dated
   follow-up.
4. Record a fresh ship-or-block disposition here and link it from #31.
5. Only then does #41 begin, and it requires its own fresh authorization.

"Probably safe" and silent deferral are not valid dispositions. This
disposition stands until a candidate without unresolved High findings has its
own passing aggregate.

## Revision history

| Date | Revision | Disposition | Note |
|---|---|---|---|
| 2026-09-17 | `3459dcaad` | BLOCK | Initial checkpoint. F1 open, F2 accepted with follow-up. |
| 2026-09-19 | `50e017578` | BLOCK | F1 fixed and verified via #294. F2 fix open as #297. F3 first observed. |
| 2026-09-19 | `aec069089` | BLOCK | #297 merged, so F2 is now fixed and verified in the reviewed source. F3 dispositioned as accepted with owner and dated follow-up after review feedback. Blocking condition unchanged. |
| 2026-09-25 | `96804bc4` (candidate), validator `185d6264` | BLOCK | First passing aggregate for the frozen candidate lifts the structural block. Re-review of the candidate's packed bytes finds F4 and F5 (High), both fixed on `main` but absent from the candidate. A new candidate is required. |
