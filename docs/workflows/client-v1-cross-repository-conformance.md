# Client v1 cross-repository evidence contract

This repository owns the deterministic SDK #38 **validator and aggregator**. It
does not run the native journey, launch Cave or Coven, touch a credential
store, publish packages, or claim that conformance has passed.

The contract validates record contents and committed source identities; it is
not a signature service for arbitrary local JSON. A committed aggregate or
evidence index is never authentication. Release readiness independently
queries GitHub for the frozen protected workflow, run, job, and artifact,
downloads each primary record, verifies its real GitHub build-provenance
attestation, and aggregates only those downloaded bytes.

Chat's separate native harness must later produce one observed record for each
platform, in this exact matrix and order:

1. `darwin-arm64`
2. `linux-x64`
3. `win32-x64`

Aggregation runs only on a Darwin or Linux coordinator. Committed-evidence
verification on those hosts authenticates the root-owned, non-writable
`/usr/bin/git` executable instead of resolving Git from `PATH`. Windows remains
a required record platform, but Node does not expose the directory-relative
publication primitives needed to support the aggregator safely on Windows.

There is no passing aggregate in this repository yet. The new 0.0.1 SDK candidate
is `96804bc483a063e41e9a9738a4ace61970f6c0a4`, tree
`aa9eb8e924735419a9afdbcc80a5b087504ccc9d`, with normalized runtime SHA-256
`8c46276b5698d32d570ad4a89998b412cb0efde5641313b0c71ae41519e64ae7`.
The frozen Chat consumer is `ef8c747f1dbae0fd2bc9fcb24d3a0914f9f1cc49`,
tree `ffd1963ef9539c7a679909200175fb11a9305c95`; its four committed vendor
archives exactly match the preserved candidate tarballs and raw release manifest.
This binding selects the merged [Chat #358](https://github.com/OpenCoven/chat/pull/358)
producer `8be8d09a3a3119ad3bc4df91652ad5ab6c45b701`, tree `15e7fe8bb298234aaa50241ceae23d70494d8bf1`.
Its reviewed head `0492818645fc098ecff74e1a285901f7527462de` has the same complete tree
and has executable harness authority
`3877057ffc6ba5d9dc22e6062bae9f0c32478f28`, tree `2db310ae3ddc54b50b3e066e456b0ca870fea604`,
as its sole parent.
The merge parents are that harness authority and the reviewed head. The validator
checks the merge-to-reviewed-source edge, the source-to-harness edge, and complete
reviewed/delivery tree equality. The intermediate source-authority path is empty.

This producer retains Chat #311's build-time home isolation, the exact Chat #314
producer-revision resolver, bounded Windows quota diagnostics, and Chat #327's
pinned-main freshness guard, and adds Chat #348's shortened isolated Windows
bootstrap root. That root is now `oc` plus the first eight hex of the run nonce
rather than `opencoven-win32-` plus all thirty-two. It prefixes every Cargo
registry source path, and `aws-lc-sys`'s deepest relative include overflowed
`MAX_PATH` beneath the longer name, failing the Windows lane at
`phase1.packaging.chat-native-build.build-script` before the resource quota
monitor was reached. All 25 governed files and ten production
deltas are bound to reviewed Git bytes. Token/profile ownership, native cleanup,
resource limits, and operator isolation remain required. The SDK candidate and
Chat consumer, Cave, and Coven revisions remain frozen.

Chat #297 classifies native installation lock, entry, read, write and persistence
failures with fixed conformance-only codes. Ordinary-build error behavior and
retryability remain unchanged. All 25 governed file identities and ten production
deltas are bound together; the checkout regression executes the selected
harness's labels. Workflow fixtures and bootstrap digests bind delivered bytes.
The Windows supervisor explicitly owns the verified profile hive and unloads
it after terminal quarantine, retaining token/profile ownership if unload fails.
Fresh child logons load their session profile explicitly. Cleanup requires both
hives absent within the existing bounded deadline, even when paths are absent.
The cleanup-grant production delta consumes the validated marker by handle
and prunes only its empty private directories under the owning identity.
Parent handles and original file identities guard each removal; siblings,
unrelated contents and replacements are preserved. Failed pruning cannot make
committed consumption retryable. The native build uses the authenticated
producer checkout; the original consumer pin does not supply this delta.
The restricted Windows test preserves the primary bounded category through
cleanup and reports a separate secondary category. Ordinary CI does not replace
fresh authenticated protected validation.
Each lifecycle probe gets a separate containment job and matching nonce/name
binding while retaining the same isolated user and profile. All three credential
and profile checks remain required, followed by terminal quarantine and verified
cleanup. Residual-open diagnostics derive fixed purpose/access labels and retain
scope; legacy role-only calls remain compatible. No native access masks, sharing,
privileges or limits change.

SDK [#302](https://github.com/OpenCoven/sdk/pull/302) delivered this binding at
`1c10e63a9ff87934397e8defc2d0b98f3932abe2`; its signed delivery tree matches the
reviewed head, and all PR and merged-main checks passed. Both validator scopes
were rotated and read back at that exact revision.

Protected [run 35500732205](https://github.com/OpenCoven/chat/actions/runs/35500732205)
is terminal failure. Linux and macOS artifacts independently passed exact
run/job and validator identities, ZIP digests, canonical schema, privacy/isolation
checks, timing, and all 197 ordered assertions each (110 Cave, 46 SDK, 41 Chat).
Windows failed at
`phase1.packaging.chat-native-build.build-script` and produced no platform
record. Validation, attestation, and aggregation were skipped. The fixed
category identifies a Cargo custom-build-command failure but does not identify
the failing dependency or underlying compiler diagnostic.

Earlier run `35146928092` used Chat #311 / SDK #293 and produced independently
verified Unix records with 197 assertions each. Its Windows checkout-quota
failure is separate from the current native-build failure and from run
`35138402347`'s operator Cave-home isolation failure.

Historical run `35125287541` failed Windows execution-root cleanup before
isolation validation. Run `35111662551` failed Windows isolation; run
`35100084575` failed Windows secure-store preflight and deletion-purpose cleanup.
Keep these failures distinct. Windows repair and a complete authenticated
three-platform aggregate remain required. Chat consumer, candidate, Cave and
Coven identities remain frozen.

Production Cave remains `ecdcdcf8a75b62bb912ec48215ae20ab0809a181`,
release `0.4.2`.

The SDK package fixture provenance remains
`e806655a7100e9d589662a6f3817c3fd8cde48ad`, distinct from production Cave.
The registry retains all 110 ordered Cave assertions and binds the actual Cave
`ecdcdcf` engine: 153,390 bytes, SHA-256
`e2742e3041648082e1087313f005a6e9407e2b8d2180881c42e109257804ec7b`.
Registry bytes bind the schema, then both bind the lock.
The old 0.1.0 candidate and its evidence remain historical records.
`aggregateRecord` remains `null`, `publishingEnabled` remains `false`, and
all packages remain private. This binding accepts no #38 evidence or #40 SHIP.

The preceding protected run `34916510997` used
Chat #278 producer `39ca57341647d7b00c210103dfc844a9d170d2cd` and SDK #268
validator `7ed60f0cc6210e8c89d489d1bb5ddf42e1b13baa` with candidate `96804bc`.
Linux and Darwin records independently passed identity, timing, and all 197
ordered assertions. Windows failed before publishing a record at
`phase1.cave-authority.startup.discovery.missing.read.not-found.publication.root-owner-unverified`.
The frozen Cave diagnostic includes probe execution, timeout, and report-parsing
failures; it does not establish an incorrect owner. Profile cleanup separately
failed a child relative-open with `ntstatus=c0000022`. Validation, attestation,
and aggregation were skipped. No Windows record identity, timing, or assertion
mismatch is established because no Windows record exists.

The [Cave source-only qualification](https://github.com/OpenCoven/sdk/issues/40#issuecomment-5671819613)
covers the earlier 77-file frozen-to-`5ee8545` upgrade. Cave #5410 then removes
cmdlet-dependent ACL probe construction; its `ecdcdcf` candidate passed all 17
jobs in rc7 run `34896723149`. The five frozen Cave artifacts and engine bytes
remain identical to `5ee8545`. Neither upstream CI nor source adoption proves
protected startup success, aggregate acceptance, or npm provenance acceptance.
The complete Git-derived fixture `tests/fixtures/chat280-cave5ee-source.json.br`
retains source commit objects, full producer/harness governance and runtime
files, native deltas, original consumer files, Cave engine and fixture bytes,
and the previous binding for rejection tests. The existing compressed workflow
fixtures contain complete current source bytes, not substituted tokens.

Chat #283 landed after PR run `34925158331` and recovered push run
`34925125894` attempt 2 passed. SDK #272 landed as
`129d4fde5cc72929cb7b18cb6a9170a20fd2d8f2` after full repository verification,
independent binding review, and all eight hosted checks passed. Its exact
reviewed tree and GitHub signature verified. Both protected validator scopes
were rotated to that actual merge and read back exactly.

The preceding SDK #269 protected run `34922030401` passed independently inspected Linux and Darwin
records, including identity, timing, and all 197 assertions. Windows failed at
`phase1.stage.schema-v2-production.failed` before publishing a record; cleanup
separately failed a child relative-open with `ntstatus=c0000022`. No Windows
record identity, timing, or assertion mismatch is established. Downstream
validation, attestation, and aggregation were skipped.

Previous protected run `34928011200`, attempt 1, used Chat #283 and SDK #272.
Supervisor job `104250094041` passed; artifact `10379899103` matched the run,
source, uploaded ZIP digest and single executable. The exact frozen workflow
was authenticated before platform approval. Linux job `104250523066` and macOS job `104250522950` passed. Each retained
record independently passed archive/run binding, canonical schema, private
scans, exact identities, Cave timing, and all 197 ordered assertions. Windows
job `104250523120` failed with
`phase1.stage.schema-v2-production.unclassified.error` and published no record.
This identifies an Error-class fallback; an approved producer diagnostic missing
from the outer allowlist can also produce it. It does not identify a failing
operation or a record identity, timing, or assertion mismatch. Cleanup separately reported child relative-open
`ntstatus=c0000022`. Validation, attestation, and aggregation were skipped;
complete protected acceptance remains absent.
No Windows repair is established. Candidate `96804bc` and its runtime digest remain
unchanged; later SDK APIs on main are not recaptured. `publishingEnabled` stays
`false`, `aggregateRecord` stays `null`, and the packages stay private.
Final artifacts, protected evidence, registry compatibility, and #40 SHIP remain
separate gates.

The historical diagnostic checkpoint from protected run `34763766701` used
the pre-adoption Chat producer
`311dda625b20aaa91c7bf2b19718387ec56acab0` with SDK validator
`56fcf68e819c7f73201989e3c0f77fc2d17c0112`. Linux and Darwin passed; Windows
failed at `phase1.native-scenarios.launch.discovery-not-found`. Artifact
validation, attestations, and aggregation were skipped, so no aggregate
exists. The run is pre-adoption evidence and does not establish protected
success or a root-cause repair. Fresh protected evidence is required.

Protected run `34773356378` later failed closed on Windows with
`access-denied`, root `cave-checkout`, operation
`directory-enumeration-depth-3-plus`, and `repeat=readable`. Chat #263 repairs
only that classified case: after an initial access denial, quota accounting may
accept one fresh, complete, bounded traversal with the same arguments and
validated isolated identity. The first partial traversal is discarded;
missing, partial, persistently denied, metadata, and file-length outcomes
remain terminal. Full ordinary Chat CI run `34779648793` passed the native
Windows supervisor regression and all other jobs, but it is not protected
conformance evidence. That repair required a merged validator and rotation of both protected
validator scopes before a fresh protected run could establish platform
acceptance, artifact validation, attestations, or aggregation. Later binding
and evidence checkpoints are recorded below.

Protected run `34782181876` then proved that the quota repair cleared the
previous blocker: Linux and Darwin passed, while Windows reached native launch
and failed closed at `phase1.native-scenarios.launch.discovery-not-found`.
The protected supervisor's real-profile `.coven` DACL contains a read-only
`OWNER RIGHTS` (`S-1-3-4`) ACE. Cave treated that special SID as a foreign
principal and attempted a DACL rewrite, but the ACE intentionally suppresses
the owner's implicit `WRITE_DAC`; Cave therefore withheld discovery.
OpenCoven/coven-cave#5388 admits `OWNER RIGHTS` only when it is an `Allow` ACE
with no writable rights. Writable owner-rights entries, foreign writers, deny
entries, inherited DACLs, malformed reports, and unreadable DACLs remain
refused. Chat #264 binds that Cave merge without changing the supervisor ACL,
quotas, isolation, waiver policy, publication checks, or deadlines.

The adopted Cave authority retains bounded, source-attributed discovery
read/publication diagnostics and adds the narrow read-only `OWNER RIGHTS`
compatibility without forwarding raw errors or changing authority gates. The
frozen Chat production decoder and signed harness decoder are unchanged.
Protected run `34789638633` proved that repair and then failed closed at
`phase1.native-scenarios.cleanup-grant.marker-identity-unavailable`. Chat #265
routes the explicit Windows cleanup-marker home to the restricted token's real
profile, binds the trusted-root exception to that exact profile's volume and
file identity, and keeps `.coven`, `chat`, and the marker directory
current-user-owned. Ambient `HOME` remains current-user-only. Handle pinning,
reparse rejection, writer restrictions, write-through publication, single-use
consumption, quotas, cleanup, and deadlines remain unchanged.
OpenCoven/chat#267 completes the bounded launch-boundary and Windows lifecycle repair.
Every native launch response emits a request-bound stderr checkpoint before
stdout; missing boundaries and input-transport failures poison attribution
without exposing stderr. The Windows supervisor retains verified process
handles for termination diagnostics, keeps profile-free launch semantics, and
allows only one complete quota remeasurement after first-pass access denial
followed by a missing-path observation. Persistent repeats remain terminal.
Isolation, quotas, cleanup, deadlines, and fail-closed behavior remain unchanged.
Independent merged-producer, source-head, executable-harness, production,
candidate, Cave, and Coven comparisons remain fail closed. These repairs
required a newly bound protected run to determine whether the publisher could
produce a Windows record and allow validation, attestation, and aggregation.
Their ordinary CI did not establish those outcomes; later evidence is recorded
in the final binding checkpoint below.
The verifier authenticates those independent identities by fetching the merged
producer, source head, every bounded source-authority-path commit, and harness
Git commit objects plus the merged producer's exact
`phase1-conformance.lock.json`. It requires the source head to be the merged
producer's second parent, verifies every frozen tree and parent edge, and
matches the Chat lock's revisions and release metadata before accepting any
protected-run evidence.

Both harness clients give `cave_launch` a 40-second response budget around
Rust's 30-second readiness deadline. Other RPCs retain their 10-second bound.
Only allowlisted launch-stage codes are retained; unreviewed codes remain
unknown. A service-unavailable result alone does not prove timeout. Quota I/O categories expose
neither paths nor raw HRESULTs, and unreviewed values remain generic `io`.

The supervisor creates and owns the actual restricted-token profile before
child launch, verifies token/profile agreement, and retains profile and
application directory handles with directory-list access and no delete
sharing. The producer publishes its native fixture beneath that profile's
`.coven/cave`, matching Rust token-profile discovery. A forged caller value
cannot redirect publication. The owned application subtree shares the existing
bootstrap and harness aggregate quotas. Quarantine must complete before pins
are released and owned profile/account cleanup proceeds; failure retains
ownership for retry.

The Windows bootstrap must contain exactly one canonical bounded gzip/base64
block matching the independently reviewed C# size and digest. The exact parent
script hash gate remains mandatory after this bounded source check. Quarantine regression tests mutate
and re-encode that source through the actual workflow verifier, preserving
coverage across the compressed representation.

The bound quota diagnostic distinguishes a readable follow-up from a missing
file or directory. Every outcome preserves the initial quota failure and
rejects the measurement. Persistent means another nonmissing exception, which
need not match the first.

The native regression proves SYSTEM or Administrators ownership using the
isolated process token profile before testing the discovery reader. Unknown
ACL metadata for a trusted profile owner remains unavailable and rejected. Follow-up observations do not
capture the original read and never authorize launch. Existing discovery
trust, quota, assertion and dependency policies remain unchanged. Native
protected validation and release acceptance remain outstanding.

The validator must merge and both protected scopes must be rotated before a
fresh protected run.

The reviewed GLib-adoption ancestry through Chat #210 includes
`9f073f05241c2d3241b23ed9d73b26c6cd55ce7e`, retained by this producer.

The Windows supervisor accounts directories through the already validated
isolated-user token at all three quota scan sites. Each read owns a
noninheritable duplicate; terminal accounting follows account disablement.
Private ACLs, the bounded walker and first-failure reporting remain enforced.
The binding refreshes the exact producer, harness, Cave authority, workflow,
Windows bootstrap, Unix preparation metadata and fixtures for the reviewed
dedicated Cave ACL repair temp.

Protected run `34667436672` used Chat `f77b249` and SDK `5730979`.
Linux and Darwin records independently passed archive digests, scans, exact
identities, Cave timing and all 197 ordered assertions. Windows reached the
Cave authority command and reported `phase1.cave-authority.startup`; validation,
attestation and aggregation were skipped. This identifies a startup/readiness
family, not a record identity, timing or assertion mismatch. The earlier quota
denial in `34666399779` remains a separate observation.

Protected quota-depth run `34670074847` used Chat #229 and SDK #212.
Linux and Darwin again passed independent record verification with all 197
ordered assertions each. Windows failed closed with `access-denied`, root
`bootstrap-aggregate`, operation `directory-enumeration-depth-3-plus`. This
identifies a capped descendant depth in the bootstrap tree; it does not
establish a Cave record identity, timing or assertion mismatch. Validation,
attestation and aggregation were skipped. This remains separate from the
Cave startup observation.

Protected run `34672157833` used Chat #230 and SDK #213. Linux and
Darwin independently passed archive digests, scans, exact record identities,
Cave timing and all 197 ordered assertions each. Windows failed closed with
`access-denied`, root `harness-cargo-registry`, operation
`directory-enumeration-depth-3-plus`. Validation, attestation and aggregation
were skipped. This is distinct from the earlier bootstrap quota denial and
Cave startup observation; it establishes no Cave identity, timing or assertion
mismatch. The new scope/repeat fields require fresh protected evidence before
any transience or persistence claim. Both validator scopes must select the
verified SDK merge before that run. No passing aggregate or completed release
acceptance is claimed here.
Protected run `34675842331` used Chat #231 and SDK #214. Linux and
Darwin independently passed archive digests, scans, exact record identities,
Cave timing and all 197 ordered assertions each. Windows reached the Cave
authority, but discovery publication failed with the fixed subtype
`phase1.cave-authority.startup.discovery.missing`. The listener remained
healthy because publication errors are intentionally degraded. The root cause
was a redundant `SetOwner` call that requires `WRITE_OWNER`, which the
protected standard user intentionally lacks. Validation, attestation and
aggregation were skipped. The Cave and Chat repairs require this newly bound
SDK validator and a fresh protected matrix before any passing aggregate or
completed release acceptance is claimed.

Protected run `34687009654` used merged Chat #233 and SDK #216. The frozen
supervisor build passed, Linux and Darwin passed all conformance checks, and
Windows progressed through restricted Cave startup and discovery before
failing at `phase1.cave-authority.assertion.takeover`. That focused proof alone
allocated its scratch fixture beneath the restricted repository checkout,
bypassing the canonical Cave temp root. Cave #5378 now allocates the takeover
fixture through the existing conformance temp helper, setting and restoring
`TEMP`, `TMP`, and `TMPDIR` in cross-platform tests while preserving authority
assertions, cleanup, quotas, bounded diagnostics, and fail-closed behavior.
Chat #235 binds the merged Cave repair without changing the frozen workflow,
bootstrap, Unix preparation, native-test, package, toolchain, runner, or
artifact bytes. That repair required a newly bound SDK validator and rotation
of both protected scopes before fresh protected acceptance could be evaluated.
Later run outcomes are recorded separately below.

Chat #219 and the final protected acceptance gate remain open.

The Coven daemon and observation source is merged revision
`8c3735f374d6bc95e5b6fd107f7e7308fa26a2f8`, tree
`163ea5b3fb89c741679dce0e121a2c1d9391472f`. Frozen Chat source
`ef8c747f1dbae0fd2bc9fcb24d3a0914f9f1cc49` retains its native `coven-client`
Cargo dependency at Coven commit `721437b84026c042e431b0882dcd14fdb29ac07d`.
This adoption includes
intervening Coven production and dependency-version changes; a fresh complete
protected run must prove compatibility. It preserves the SDK candidate,
observation selection, resource ceilings, and dependency policy. The workflow and Windows parent-bootstrap fixture bind the scoped-reader bytes.

Both the schema-v1 and schema-v2 harnesses preserve the resolved Rust
toolchain ahead of the supervisor PATH, without inheriting Cargo credentials
or a global Rust default.
Schema-v2 also preserves the built Chat RPC executable outside its Cargo
target and removes that target before the Coven build. It now preserves the
built Coven executable the same way and removes the Coven target before the
shared observation target starts. Residual observation failures expose only
fixed SDK/Chat install, test, Rust-test, or cleanup substages; Windows disk,
silent exit, and native process failures remain bounded to path-free
diagnostics.
The harness preserves bounded Cave record identity, timing, and assertion
diagnostics through both producer wrappers. Malformed timestamps are rejected
before range comparisons; record values and private error causes are never logged.
Windows schema-v2 commands use the nonce-bound pnpm CLI through Node, and
the bootstrap does not reference child-only variables in the parent scope.
The Windows bootstrap accepts only the reviewed image/Visual Studio pairs
`20260824.214.3`/`18.9.12112.369` and
`20260907.229.1`/`18.9.12120.119`, reviewed against immutable
`actions/runner-images` inventories. Unknown images, unknown Visual Studio
versions, and crossed pairs fail closed; other runtime pins, trusted paths,
signature checks, containment, and quotas remain unchanged.
Windows quotas follow the isolated identity's actual temporary directory.
The Cave checkout receives 4 GiB while execution and bootstrap aggregates
retain their 10 GiB and 12 GiB bounds. Only Windows schema-v2 native builds
disable debug symbols and incremental compilation, including the shared
observation target. The primary bounded failure is emitted before cleanup;
cleanup failures still fail closed.
Child tracking accepts a recycled PID only after the former child completes.
Asynchronous termination removes only the child instance it reaped; cleanup
retains the root and fails if replacement children still need cleanup.
Coven observation diagnostics distinguish `tracking` from six fixed launch
codes (`spawn.enoent`, `spawn.eacces`, `spawn.eperm`, `spawn.einval`,
`spawn.e2big`, and `spawn.enomem`), retaining `spawn` for other launch failures.
Historical protected run `34413820955` passed Linux and macOS but reported
Windows `legacy-case.spawn`, which conflated launch and tracking.
Earlier protected run `34441519622` used Chat `b7986d0` and validator
`d1c9ddf`. Linux and Darwin records passed identity, digest, timing, scan, and
all 110 Cave, 46 SDK, and 41 Chat assertion checks. Windows reported
`phase1.runtime-observations.coven-rust-tests.status-replacement.assertion.writer-error.apply-owner-only-security.access-denied`.
Validation, attestation, and aggregation were skipped. Coven #984 tracks the
native ACL failure. Coven #988 has since merged; fresh protected acceptance
for the current binding remains required.

Chat #203 separately repaired packaged provenance checks that incorrectly
required ancestry between independently frozen Chat/SDK authorities. Exact
revision, tree, clean-checkout, file digest, and native-delta checks remain.
Its complete ordinary CI run `34451030376` passed packaged conformance.
The current binding includes that provenance repair through the later #213
producer and harness identified above. Ordinary CI does not replace fresh
protected validation after both scopes rotate.

## Frozen reviewed inputs

[`conformance/client-v1-cross-repository-lock.json`](../../conformance/client-v1-cross-repository-lock.json)
is the single machine-readable artifact and source lock. It freezes:

- SDK package candidate
  `96804bc483a063e41e9a9738a4ace61970f6c0a4` and its committed tree;
- the private-source **conformance artifact** `release-manifest.json`,
  including its exact 1,031-byte canonical JSON representation and SHA-256;
- the four package names, versions, release filenames, Chat vendor paths,
  sizes, SHA-256 values, and order;
- the SDK candidate's Cave contract fixture, fixture digest file, provenance
  file, HPKE vector file, and HPKE digest file;
- the exact Cave, Coven, and Chat production commits and committed trees;
- Cave's assertion engine, source fixture, and HPKE vector file metadata;
- Chat's consumer lock and vendored SDK package metadata;
- Node, pnpm, Rust, and Tauri versions;
- scanner names and versions;
- the exact ordered platform matrix;
- the immutable schema identity, path, version, size, and SHA-256;
- the assertion-registry path, size, and SHA-256; and
- the merged Chat producer, source-bound producer head, executable harness
  authority, package manifest, schema-v2 harness, and protected workflow bytes.

The schema identity is
`urn:opencoven:schema:client-v1-cross-repository-platform-evidence:2`, not a
mutable branch URL. The schema embeds the exact assertion-registry metadata.
Runtime validation checks lock bytes to schema bytes, then the schema binding
to the exact registry bytes and ordered matrix.

The immutable schema-v2 field names `releaseManifest` and `sdkPackages` refer
only to the frozen conformance artifact set consumed by Chat. They are not npm
publication candidates. Publication uses a separate schema-v2 artifact
manifest, source commit, and #40 review identity defined by
[`conformance/release-artifact-manifest.schema.json`](../../conformance/release-artifact-manifest.schema.json)
and `release.config.json` `publicationCandidate`.

The validator commit is deliberately **not** the package candidate commit. Each
platform record identifies the later SDK validator commit and tree separately.
The aggregator validates its own clean checkout against that identity.

[`conformance/client-v1-cross-repository-assertions.json`](../../conformance/client-v1-cross-repository-assertions.json)
contains the complete frozen assertion registry. Its Cave list was imported
once from the exact locked Cave engine with TTL and authority-takeover enabled.
Runtime aggregation does not ask the engine to select IDs dynamically.

## Platform producer compatibility

The frozen producer uses Chat's existing schema-v1 authority journey as an
internal source, but emits schema v2 only after receiving every frozen SDK and
Chat assertion from an exact observed-result map. Missing, duplicate,
unexpected, skipped, failed, or blocked observations produce no record.

The protected dispatch requires a full lowercase `validator_revision`. The
Chat commit does not pin that SDK revision, so the SDK validator can freeze the
already-committed Chat producer without creating a mutual commit-hash cycle.
The selected checkout still supplies and binds the exact validator
commit/tree, contract, schema, registry, and frozen-lock bytes in every record.
The protected environment is `client-v1-conformance`, environment ID
`20863036831`. GitHub must report administrator bypass disabled, exactly one
required reviewer with immutable user ID `68980965`, `prevent_self_review` set
to `false` so the dispatcher and sole reviewer can approve, no wait-timer rule
(zero minutes), and protected-branch-only deployment policy. Aggregation
rejects any policy drift.

### Dispatching against a merged ancestor

The validator also recognizes Chat #314's exact `producer-revision` resolver
and its `producer_revision` input. The resolver checks a full lowercase commit
ID against the dispatch commit's ancestry before any producer checkout. Its
script, dependencies, permissions, checkout references, and successful GitHub
job are verified alongside the existing protected workflow.

For such a run, `evidenceProducer.commit` remains the selected harness revision.
`workflow.sourceDigest` and `workflow.signerDigest` identify the dispatch
revision. Set `workflow.sourceDescent` to the ordered Git commits from dispatch
to producer, including both endpoints (2–16 unique commits). Local aggregation
and GitHub verification inspect every actual parent edge. Runs, jobs,
deployments, artifacts, and certificates must identify the dispatch revision;
platform records must still identify the selected producer.

Both revisions must contain the same reviewed workflow bytes. The current
frozen producer includes the resolver, and its empty descent selects the
producer tip itself. A later dispatch requires an explicitly reviewed descent
binding before its evidence can be accepted. Historical
locks and indexes that omit the field retain that same tip-only meaning.
Supporting the resolver does not supply the missing three-platform evidence
or change the release's BLOCK disposition.

## Exact platform record

Every input must satisfy both:

- [`conformance/client-v1-cross-repository-evidence.schema.json`](../../conformance/client-v1-cross-repository-evidence.schema.json);
- the stricter executable parser in
  [`scripts/conformance-contract.mjs`](../../scripts/conformance-contract.mjs).

The JSON Schema is executed during aggregation. Unknown fields fail at every
SDK-owned object because `additionalProperties` is `false`. Input JSON is
limited to 1 MiB, 50,000 nodes, 32 levels, and 16 KiB per string.

The schema-v2 fields are:

| Field | Required meaning |
| --- | --- |
| `platform` | One exact native matrix identifier |
| `timing` | Canonical UTC start/end timestamps and their exact millisecond duration |
| `environment` | OS, architecture, Node, pnpm, Rust, Tauri, native custody backend/availability, and Coven peer/pipe identity backend/availability |
| `releases` | Exact Cave and Coven release versions |
| `provenance.candidate` | Frozen packed SDK candidate commit and tree |
| `provenance.validator` | Later SDK validator commit/tree plus committed contract and schema metadata |
| `provenance.cave` | Frozen Cave source commit and tree |
| `provenance.coven` | Frozen Coven source commit and tree |
| `provenance.chat` | Frozen Chat production source commit and tree |
| `harness` | Harness path/name, version, repository, commit, tree, and opaque UUID invocation ID; no raw command |
| `artifacts` | Frozen lock, registry, manifest, four packages, candidate Cave files, Cave authority files, consumer lock, and Chat vendor files |
| `caveRecord` | Exact Cave-rendered record, re-rendered for equality by the committed Cave engine |
| `sdkAssertions` | Every frozen SDK ID once, in order, with `pass` |
| `chatAssertions` | Every common plus platform Chat ID once, in order, with `pass` |
| `coverage` | `cave`, `coven`, `sdk`, and `chat`, all `true` |
| `notCovered` | The complete four-entry frozen exclusion set, in order |
| `isolation` | Opaque 32-hex root IDs, ownership/removal proof, and unchanged operator-state digests |
| `scans` | Passing producer redaction and retained-evidence scans with exact scanner names/versions |

The platform-specific custody backends are `macos-keychain`,
`linux-keyring`, and `windows-credential-manager`. The Coven identity backends
are `unix-peer-credentials` on Darwin/Linux and
`windows-named-pipe-client-identity` on Windows. Availability must be `true`.

`notCovered` is exactly:

- `cross-process-pairing`
- `oauth-ui`
- `remote-peer`
- `write-apis`

It is not an arbitrary subset. SDK and Chat are required covered subjects and
cannot appear in it.

## Redaction and isolation

Records retain opaque IDs, digests, versions, relative reviewed artifact paths,
and stable diagnostic IDs. They do not retain operator paths or identifiers.

The validator normalizes keys across case and punctuation before rejecting
pairing secrets, bearer/token/password/credential/private-key/API-key fields;
prompt/message/content/attachment/command-output/private-cause fields;
headers, URLs, socket or pipe handles; and raw diagnostics. It also rejects
all absolute POSIX paths, Windows drive/UNC/device paths, named pipes,
abstract Unix sockets, `file:` and network URLs, and email-shaped operator
identifiers. These values are rejected after punctuation as well as at string
boundaries, including inside Cave detail and finding text.

Approved UUID invocation IDs, 32-hex opaque root IDs, SHA-256 values, versions,
diagnostic IDs, repository slugs, relative locked artifact paths, and public
Client v1 API routes remain allowed. Route allowance is field-aware: the exact
Cave `findings` and `notCovered` grammar may contain reviewed literals such as
`/api/client/v1` and `/familiars`, but unrestricted content and arbitrary
absolute filesystem paths remain rejected.

## Aggregate three completed records

Aggregation becomes available only after the frozen lock names a compatible
producer. It then requires the exact clean candidate, Cave, Coven, Chat source,
and Chat producer checkouts plus one protected-job record for every platform
in locked order. `--out` remains a filename, not a path, and publication is
restricted to the fixed owner-private root:

```text
.artifacts/client-v1-cross-repository-results/
```

The destination must not exist. The CLI holds an exclusive owner-private
directory lock, creates the temporary file directly in the fixed evidence
directory, and keeps its descriptor open from the initial write through final
publication verification. It verifies exact bytes through that descriptor
before linking, opens the destination without following symlinks, verifies
descriptor identity and bytes on both names, removes the temporary name,
requires one remaining link, verifies the bytes again, and `fsync`s the file
and directory. Same-inode rewrites, temporary-path replacement, output-root or
lock replacement, unexpected aliases, concurrent creators, and durability
failures trigger exact-inode rollback and fail closed.

Aggregate JSON is recursively key-sorted, two-space indented UTF-8 with LF
line endings and exactly one trailing newline. Arrays retain their contractual
order. Platform input order and object key order therefore cannot change the
published bytes.

After the protected jobs complete, the SDK verifier downloads and authenticates
the records before producing the exact aggregate bytes. Copy those bytes into:

```text
docs/client-v1-cross-repository-results/96804bc483a063e41e9a9738a4ace61970f6c0a4.json
```

Create the sibling reviewed evidence index:

```text
docs/client-v1-cross-repository-results/96804bc483a063e41e9a9738a4ace61970f6c0a4.index.json
```

The index records the expected aggregate and primary-record digests, exact
producer commit/harness/workflow/source-ref identity, workflow byte
size/SHA-256, the dedicated two-job graph, hosted-runner labels, protected
environment ID, one shared run attempt, unique matrix job and deployment IDs,
artifact digest, attestation subject digest, and attestation-bundle digest. It
also freezes the platform-derived artifact/record path templates, SLSA
predicate, signer workflow, signer digest, source digest, and prohibition on
self-hosted runners. These values are locators and review expectations, not
self-authenticating claims.

Release readiness uses `gh api` to fetch the workflow bytes at the frozen Chat
commit and requires their exact reviewed size and SHA-256. The dedicated
workflow is then parsed with the same unambiguous YAML parser used for the
release workflow. It must use printable ASCII with LF endings and a final
newline, and cannot use anchors, aliases, merge keys, block scalars, duplicate
keys, or prototype-shadowing keys.

The parsed document must equal the complete reviewed structure: only a manual
dispatch trigger with one required string input named `validator_revision`,
top-level `contents: read`, the exact ordered
platform/runner matrix, the protected environment, the exact job permissions,
and exactly five jobs. The protected matrix job has exactly 19 ordered steps:
pinned checkout without persisted credentials, pinned Node and pnpm setup,
frozen dependency and Rust setup, a Linux-only exact package setup for
`dbus-daemon`, `gnome-keyring`, and `libsecret-tools`, exact
Node/pnpm/Rust/Tauri verification, exact harness size/SHA-256 verification,
reviewed resolution of exact `node`, `pnpm`, and `rustup` real files plus a
minimal Unix tool path containing only exact Git/system directories, and
invocation of the frozen harness with the selected validator SHA. The
supervisor copies the three executables into a root-owned trusted directory;
the governed harness invokes `pnpm` directly, with Corepack and private
runner-home directories excluded. The supervised Unix step must consume those
exact step outputs and cannot forward ambient `PATH` or fall back to it.
Windows bootstrap uses
`ProcessStartInfo` and `Process.ExitCode`, never `$LASTEXITCODE`, and launches
the pinned npm and pnpm JavaScript entrypoints directly through pinned Node
rather than `.cmd` or `.bat` shims. Its exact embedded supervisor skips
unreadable primary-token owners only for Idle or session 0, while every
nonzero-session ambiguity still refuses with the process and session IDs.
The exact supervisor test source prints bounded nested exception diagnostics
and uses the reviewed 60-second bounds at all eight spawned-process readiness
sites. Linux production runs inside Chat's committed private D-Bus/Secret
Service wrapper. The remaining steps perform read-only canonical JSON and
platform validation, pinned official artifact upload, and pinned official
provenance attestation. The artifact name occurs as a scalar exactly once, and
the record path is identical across generation, validation, upload, and
attestation. There is no mutable step after validation.

No other action, command, permission, output, condition, expression, local or
reusable workflow, upload path, or attestation path is accepted. The
aggregation job has no permissions and can only confirm successful completion
of the protected matrix; it cannot generate, upload, attest, or replace a
platform record. This structural template is exercised synthetically in tests
only. An earlier lock marked the merged Chat producer at
`9c4aa1f2de8f38fd776e76f7882ffc871f9b426e` compatible with the reviewed
schema-v2 workflow bytes and separately froze its source-bound head and
executable harness authority. That producer is historical; the conformance
lock identifies the current producer and the final checkpoint records its
delivery. Release readiness still requires all three protected platform records,
reviewed GitHub attestations, and the canonical aggregate.

Before dispatch, verify that Chat main still equals the frozen producer commit.
If another Chat change lands first, rebind this validator to that merged producer
and recheck its exact workflow and harness bytes before rotating the protected
variable. Dispatch from main with the same merged SDK revision as
`validator_revision`; a successful ordinary CI run does not replace protected
conformance. Keep `publishingEnabled: false` and the aggregate record unset until
all release evidence requirements are met.

The three records must come from one exact run attempt. The verifier fetches
the attempt's complete job list and requires exactly the three successful
matrix expansions plus the successful aggregation job, with no sibling or
alternate job. Because the artifact API does not expose its producing job, the
index also freezes one deployment ID per matrix job. The verifier fetches the
exact environment, requires current required-reviewer and protected-branch
rules, fetches each deployment and all statuses, and requires both a
pre-execution `pending`/GitHub Actions `waiting` status and a successful status
whose `log_url` and `target_url` identify the exact numeric matrix job ID. It
then fetches the unique run artifact and downloads it with:

```bash
gh run download <run-id> \
  --repo OpenCoven/chat \
  --name client-v1-conformance-<platform>
```

It then downloads the bundle and runs the equivalent of:

```bash
gh attestation verify <artifact> \
  --repo OpenCoven/chat \
  --signer-workflow OpenCoven/chat/<locked-workflow-path> \
  --signer-digest <locked-producer-commit> \
  --source-digest <locked-producer-commit> \
  --predicate-type https://slsa.dev/provenance/v1 \
  --deny-self-hosted-runners \
  --bundle <attestation-bundle> \
  --format json
```

`GH_TOKEN` is injected only into the exact `gh api`, `gh run download`, and
`gh attestation` subprocesses. The validator scrubs both `GH_TOKEN` and
`GITHUB_TOKEN` before local Git inspection and before loading or invoking the
committed Cave assertion engine; package build and packing subprocesses use
their own sterile token-free environment.

The verifier checks the attestation certificate's source repository, source
ref, source digest, signer digest, GitHub-hosted runner identity, and exact
run-invocation URI. The attestation subject must equal the downloaded canonical
record digest, and the bundle digest must equal the reviewed index. Only the
three downloaded records are aggregated. That generated aggregate must
byte-match the committed aggregate.

There is intentionally no offline acceptance mode. Supplying only committed
JSON claims, even with plausible GitHub IDs and matching copied hashes, fails
closed because the verifier cannot authenticate the primary platform bytes or
job identities. Only after live verification may the aggregate, index, and
`release.config.json` `conformanceEvidence.aggregateRecord` change be reviewed
together.

Release readiness reads only committed regular files at `HEAD`, rejects any
working-tree drift, requires the exact sibling evidence index, revalidates the
lock-schema-registry chain, and checks validator/candidate ancestry and bytes
from Git history. `.node-version` is part of the exact validator runtime and
the process must be Node `v24.18.1`. The release workflow checks out the exact
frozen Cave source and supplies it through
`OPENCOVEN_CAVE_AUTHORITY_ROOT`; the verifier executes the exact committed Cave
engine bytes and re-renders every Cave record rather than trusting
aggregate-copied summaries, findings, scan labels, isolation labels, or
harness claims.

Run the focused validator suite with:

```bash
corepack pnpm@10.34.0 test:conformance-contract
```

CI tests the parser, schema, lock, registry, checkout failures, scanner,
canonical serialization, and publication races with synthetic fixtures. Those
fixtures are not platform evidence and are never retained as a passing result.

Protected run `34406621503` passed Linux and macOS, but Windows failed at
`phase1.runtime-observations.coven-rust-tests.failed` after SDK, Chat, and
Chat Rust observations. Validation, attestation, and aggregation were skipped.
The successor preserves every selected test and existing limit while
reporting a bounded category for each of the five selected Windows Coven
observation commands. It distinguishes command failures, an exact test failure,
and a successful command missing the expected test; raw output stays private.
The new diagnostics require a complete protected attempt after final binding.

Chat #285 landed as `6089bab8` after PR run `34932603467` and push run
`34932601258` attempt 2 passed. Three regressions reproduced the diagnostic
loss before the fix. This SDK binding refreshes the exact producer, source,
harness, complete Git fixtures and three bootstrap digests. Candidate, Cave,
Coven and original Chat consumer authorities remain unchanged. This proves
the diagnostic correction, not the failing hosted stage or Windows repair.
At this historical Chat #285 checkpoint, the SDK binding still required
reviewed landing, both validator scope rotations and fresh authenticated
protected validation. Scopes then selected SDK #272 (`129d4fde5`).

## Historical integrated native-preflight binding, Chat #292

Chat #292 landed as `b7578a653512095a84cd2cd87f33b2f2036221d5` after required
checks passed. Its signature is valid and its complete tree equals reviewed
head `92151f0600bc2db860a73f90d0d5abd8b354cb06`. The binding retains the explicit
intermediate authority path to harness `683e9991`; the equal-tree and parent
validation gates are unchanged. Compressed fixtures contain actual Git objects
for the delivery, reviewed head, both intermediates, and harness.

At that checkpoint, both validator scopes still selected SDK #274 (`1535e48e`).
The latest terminal protected run then was `34935323170`, using Chat #285 and SDK #274:
Linux/macOS records passed independent checks of identity, Cave timing, and all
197 ordered assertions. Windows failed at `phase1.native-scenarios.native-preflight`
and produced no record; cleanup separately reported child-open access denial
`ntstatus=c0000022`. Validation, attestation, and aggregation were skipped.

The next steps at that checkpoint were SDK binding verification and landing,
validator-scope rotation with readback, producer identity verification, and fresh
protected validation with supervisor authentication before environment approval.
Subsequent delivery and run outcomes are recorded below.
The four new preflight boundaries identify an operation; they do not prove a
Windows repair. No aggregate, publication, or release acceptance is claimed.

## Protected Chat #293 binding checkpoint

On 2026-09-15, SDK [#276](https://github.com/OpenCoven/sdk/pull/276)
landed as `6b4e0d04e168c7ccd99df492a0494e223150e2ab` with the verified
Chat #293 binding. Both validator scopes were rotated and read back at that
actual merge. Protected [run 34951851914](https://github.com/OpenCoven/chat/actions/runs/34951851914),
attempt 1, was dispatched with Chat `6fa5dab5` and SDK #276. Its frozen workflow
and supervisor artifact passed independent authentication before environment
approval. Linux and macOS passed independent record identity, Cave timing,
scan, and all 197 ordered assertion checks each. Windows failed at
`phase1.native-scenarios.native-preflight-installation-rpc`, during
`app_installation_id` and before the installation-ID assertion. It published
no record; validation, attestation, and aggregation were skipped. This is
terminal partial evidence, not aggregate acceptance or publication approval.
The RPC's underlying failure remains unclassified; the stage does not prove
a recurrence of the earlier quota-monitor cause.

The prior SDK #275 run `34945048615` is terminal failure: Linux and macOS
records passed independent inspection, while Windows published no record and
failed its bounded checkout directory quota monitor. Downstream attestation
and aggregation were skipped. The [#38 checkpoint](https://github.com/OpenCoven/sdk/issues/38)
tracks subsequent platform records and exact aggregate acceptance.

SDK [#277](https://github.com/OpenCoven/sdk/pull/277) separately delivered
per-client discovery v2 retention, concurrent current-credential preservation,
and snapshots used to pin pairing authority. That development-source change is
not included in frozen candidate `96804bc4` or validated by the SDK #276 run.
SDK #299 and #301 subsequently delivered pairing guard regressions and managed
HPKE iterator continuity; both blockers in #296 are closed. Native adapter
adoption remains separate. Candidate and counterpart authorities stay frozen;
a later candidate needs its own review and evidence.

## Historical protected validation result, SDK #284

Historical protected [run 34977202052](https://github.com/OpenCoven/chat/actions/runs/34977202052)
used Chat producer `047e8ad7f4a2ca5a9009217de3c3f5f32fd98ba6` and SDK #284
validator `e37b195c246d55a5929dc74f7e7d116b1fc6dfd0`. Both validator scopes
were read back at that SDK merge; the frozen workflow and supervisor artifact
were authenticated before environment approval. Linux and macOS passed;
their records independently passed exact identities, canonical schema, private
scans, Cave timing and all 197 ordered assertions each (110 Cave, 46 SDK, 41 Chat).
Windows failed at
`phase1.native-scenarios.native-preflight-installation-secure-store-unavailable`
and produced no record. Validation, attestation and aggregation were skipped.

That historical run exposed the native secure-store category without identifying
the failing installation operation. Chat #297 subsequently landed profile
ownership and cleanup repairs, bounded operation diagnostics, and a restricted
native installation roundtrip. Its ordinary CI passed. SDK #290 then landed
that binding and both validator scopes rotated for protected run `35111662551`,
which failed Windows isolation. SDK #38 acceptance remains open.

## Historical residual cleanup purpose binding, Chat #302

Chat #302 adds bounded `purpose=deletion|enumeration` labels to residual-profile
relative-open failures. Full CI [35095847759](https://github.com/OpenCoven/chat/actions/runs/35095847759)
passed, including native Windows denied-deletion and denied-directory-listing
controls. It also preserves the landed schema-v2 finalization diagnostics.
Quota retry investigation confirms `repeat=persistent` can represent a different
retry exception while preserving the initial denial; this does not establish
the protected ACL cause or a Windows repair.

That historical binding recorded the delivered producer, reviewed equal-tree source, binding
intermediate, and executable harness from actual Git objects. Historical
multi-edge fixtures and rejection controls remain intact. SDK validation gates,
candidate and consumer authorities, and protected policy are unchanged.

At that historical checkpoint, both validator scopes still selected SDK #284
(`e37b195c`), and the latest terminal run was `34977202052`. SDK #288 subsequently
landed and both scopes rotated to it for run `35100084575`, whose terminal result
is recorded above. SDK #290 then bound Chat #297 for run `35111662551`,
which failed Windows isolation. SDK #291 then bound Chat #305 for run `35125287541`, which failed
Windows execution-root cleanup. SDK #292 then bound Chat #309 for run `35138402347`, which failed
Windows operator Cave-home isolation. SDK #302 subsequently landed the Chat
#328 binding and both validator scopes rotated to it. Protected run
`35500732205` failed the Windows native build, as recorded above; no aggregate
or release acceptance is claimed.
