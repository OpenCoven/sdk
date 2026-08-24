# Cave Canonical Reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the five live Cave Client v1 canonical read operations, strict DTO parsing, and explicitly bounded pagination to the public SDK without changing the existing legacy Familiar Contract and analytics APIs.

**Architecture:** `@opencoven/sdk-core` owns reusable page/cursor option validation and bounded iteration. `@opencoven/cave-client` owns Cave-specific DTOs, envelope parsing, transport methods, and discovered bearer-authenticated routes. Existing `familiars()`, `familiarContract()`, and `familiarAnalytics()` remain source-compatible; the new paired Client v1 surface uses `listFamiliars()`, `listProjects()`, `listConversations()`, `getConversation()`, and `listConversationMessages()`.

**Tech Stack:** TypeScript 6.0.3, Node 24.18.x, pnpm 10.34.0, Vitest 4.1.10, existing operation/deadline controls, handwritten runtime guards, exact Cave Client v1 fixture.

---

## File Map

### Create

- `packages/core/src/pagination.ts` — reusable page options, cursor/page contracts, validation, and bounded async iteration.
- `packages/cave/src/canonical-reads.ts` — strict Cave DTO/envelope parsers and safe route/query construction.
- `tests/pagination.spec.ts` — core page/cursor and iterator tests.
- `tests/cave-canonical-reads.spec.ts` — caller-supplied and discovered canonical-read contract tests.

### Modify

- `packages/core/src/index.ts` — export pagination contracts and helpers.
- `packages/core/README.md`, `packages/core/CHANGELOG.md` — document bounded pagination.
- `packages/cave/src/schemas.ts` — add canonical read DTOs and transport response types without changing legacy `CaveFamiliar`.
- `packages/cave/src/transport.ts` — add optional canonical read transport methods.
- `packages/cave/src/client.ts` — expose one-page methods and Cave-specific bounded iterators.
- `packages/cave/src/pairing.ts` — wire discovered canonical reads through the existing discovery, instance proof, and bearer path.
- `packages/cave/src/index.ts` — export the new public types.
- `packages/cave/README.md`, `packages/cave/CHANGELOG.md` — document methods, limits, ordering, reconciliation, and legacy separation.
- `tests/client-contract.spec.ts`, `tests/public-contract.spec.ts`, `tests/cave-discovery-pairing.spec.ts`, `tests/cave-contract-fixture.spec.ts` — lock public signatures, discovered routes, auth behavior, and fixture limits.

## Contract Decisions

- List options accept only `limit?: number` and `cursor?: string`.
- The SDK defaults `limit` to `50`; values must be safe integers from `1` through `100`. It rejects rather than clamps.
- Cursors are opaque canonical base64url strings. The SDK validates bounded spelling but never decodes producer semantics.
- A page cursor is top-level and has `{ current?: string, next?: string, previous?: string, hasMore: boolean }`.
- Every iterator requires either a positive `maxPages` or a caller-owned `AbortSignal`; passing neither is `invalid_options`.
- Iterators stop on `hasMore: false`, reject missing/repeated `next` cursors while `hasMore: true`, and never auto-retry `reconcile_required`.
- `reconcile_required` remains a first-class non-retryable Cave error for query-layer canonical reload.
- Canonical familiar DTOs are named `CaveCanonicalFamiliar` so the existing legacy `CaveFamiliar` API remains unchanged.
- Conversation summary requires `id`, `familiarId`, and `updatedAt`; `createdAt` is optional.
- Message `parentId` is required and nullable.

### Task 1: Add reusable bounded pagination to SDK Core

**Files:**
- Create: `packages/core/src/pagination.ts`
- Create: `tests/pagination.spec.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/README.md`
- Modify: `packages/core/CHANGELOG.md`

- [ ] **Step 1: Write failing page-option and iterator tests**

Add tests covering default `50`, accepted `1` and `100`, rejection of zero/fractions/values above `100`, canonical base64url cursor spelling, mandatory `maxPages` or signal, exact stop at `hasMore: false`, max-page exhaustion, abort, and repeated/missing next cursors.

```ts
test('rejects iteration without a page bound or abort signal', async () => {
  expect(() => iteratePages(async () => ({ data: [], cursor: { hasMore: false } }))).toThrow(
    expect.objectContaining({ code: 'invalid_options' }),
  );
});

test('rejects a repeated next cursor instead of looping', async () => {
  const iterator = iteratePages(
    async () => ({
      data: ['item'],
      cursor: { current: 'eyJ2IjoxfQ', next: 'eyJ2IjoxfQ', hasMore: true },
    }),
    { maxPages: 2 },
  );

  await expect(Array.fromAsync(iterator)).rejects.toMatchObject({
    code: 'invalid_response',
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
corepack pnpm@10.34.0 exec vitest run tests/pagination.spec.ts
```

Expected: failure because the pagination module and exports do not exist.

- [ ] **Step 3: Implement strict shared contracts**

Implement:

```ts
export interface PageOptions {
  limit?: number;
  cursor?: string;
}

export interface PageCursor {
  current?: string;
  next?: string;
  previous?: string;
  hasMore: boolean;
}

export interface Page<T> {
  data: readonly T[];
  cursor?: PageCursor;
}

export type BoundedPageOptions = PageOptions &
  OperationOptions &
  (
    | { maxPages: number }
    | { signal: AbortSignal; maxPages?: number }
  );

export function normalizePageOptions(options: PageOptions = {}): {
  limit: number;
  cursor?: string;
};

export async function* iteratePages<T>(
  readPage: (options: { limit: number; cursor?: string }) => Promise<Page<T>>,
  options: BoundedPageOptions,
): AsyncGenerator<T>;
```

Use repository-standard normalized errors. Do not clamp invalid limits, decode cursor payloads, auto-retry pages, or hide aborts.

- [ ] **Step 4: Run focused and core contract tests**

Run:

```bash
corepack pnpm@10.34.0 exec vitest run tests/pagination.spec.ts tests/operation-control.spec.ts tests/public-contract.spec.ts
corepack pnpm@10.34.0 typecheck
```

Expected: all selected tests and typecheck pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/core/src/pagination.ts packages/core/src/index.ts packages/core/README.md packages/core/CHANGELOG.md tests/pagination.spec.ts tests/public-contract.spec.ts
git commit -m "feat: add bounded pagination primitives" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Add strict Cave canonical DTOs and caller-supplied transport methods

**Files:**
- Create: `packages/cave/src/canonical-reads.ts`
- Create: `tests/cave-canonical-reads.spec.ts`
- Modify: `packages/cave/src/schemas.ts`
- Modify: `packages/cave/src/transport.ts`
- Modify: `packages/cave/src/client.ts`
- Modify: `packages/cave/src/index.ts`
- Modify: `tests/client-contract.spec.ts`
- Modify: `tests/public-contract.spec.ts`

- [ ] **Step 1: Write failing public transport and hostile-response tests**

Cover all five methods, absent optional transport methods, unknown additive fields, malformed required fields, wrong types, optional fields, required-nullable `parentId`, conversation timestamp rules, malformed cursor envelopes, and explicit error envelopes.

```ts
const client = new CaveClient({
  transport: {
    health: async () => VALID_HEALTH,
    listProjects: async () => ({
      apiVersion: '1.0',
      minimumClientVersion: '0.1.0',
      capabilities: ['projects'],
      data: {
        projects: [{
          id: 'project-1',
          name: 'Project',
          root: '/workspace/project',
          createdAt: '2026-08-24T00:00:00.000Z',
          updatedAt: '2026-08-24T00:00:00.000Z',
        }],
      },
      cursor: { hasMore: false },
    }),
  },
});

await expect(client.listProjects()).resolves.toEqual({
  data: [expect.objectContaining({ id: 'project-1' })],
  cursor: { hasMore: false },
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
corepack pnpm@10.34.0 exec vitest run tests/cave-canonical-reads.spec.ts tests/client-contract.spec.ts tests/public-contract.spec.ts
```

Expected: failure because canonical DTOs, transports, and methods are missing.

- [ ] **Step 3: Implement Cave-specific DTO and envelope parsing**

Add:

```ts
export interface CaveCanonicalFamiliar {
  id: string;
  displayName: string;
  role: string;
  description?: string;
  pronouns?: string;
  status?: string;
  lastSeenAt?: string;
  activeSessions?: number;
}

export interface CaveProject {
  id: string;
  name: string;
  root: string;
  color?: string;
  repoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CaveConversation {
  id: string;
  familiarId: string;
  harness?: string;
  model?: string;
  runtime?: string;
  title?: string;
  origin?: string;
  status?: string;
  exitCode?: number;
  pending?: boolean;
  createdAt?: string;
  updatedAt: string;
}

export interface CaveConversationMessage {
  id: string;
  conversationId: string;
  parentId: string | null;
  role: string;
  text: string;
  createdAt: string;
  attachmentCount: number;
  toolCount: number;
  isError?: boolean;
  cancelled?: boolean;
}
```

Transport methods remain optional:

```ts
listFamiliars?(options: PageOptions, context?: OperationContext): Promise<unknown>;
listProjects?(options: PageOptions, context?: OperationContext): Promise<unknown>;
listConversations?(options: PageOptions, context?: OperationContext): Promise<unknown>;
getConversation?(conversationId: string, context?: OperationContext): Promise<unknown>;
listConversationMessages?(
  conversationId: string,
  options: PageOptions,
  context?: OperationContext,
): Promise<unknown>;
```

The client methods return `Page<T>` or one `CaveConversation`. Keep legacy Familiar methods byte-for-byte compatible.

- [ ] **Step 4: Run focused tests, typecheck, and lint**

Run:

```bash
corepack pnpm@10.34.0 exec vitest run tests/cave-canonical-reads.spec.ts tests/client-contract.spec.ts tests/public-contract.spec.ts tests/cave-familiars.spec.ts
corepack pnpm@10.34.0 typecheck
corepack pnpm@10.34.0 lint
```

Expected: new and legacy client contracts pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/cave/src/canonical-reads.ts packages/cave/src/schemas.ts packages/cave/src/transport.ts packages/cave/src/client.ts packages/cave/src/index.ts tests/cave-canonical-reads.spec.ts tests/client-contract.spec.ts tests/public-contract.spec.ts
git commit -m "feat: add Cave canonical read contracts" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Wire discovered bearer-authenticated canonical routes

**Files:**
- Modify: `packages/cave/src/canonical-reads.ts`
- Modify: `packages/cave/src/pairing.ts`
- Modify: `tests/cave-discovery-pairing.spec.ts`
- Modify: `tests/cave-canonical-reads.spec.ts`

- [ ] **Step 1: Write failing discovered-route tests**

Cover exact paths and query ordering, `encodeURIComponent` path segments, redirect refusal, response limits, no Authorization on the instance proof, Authorization only on the canonical request, wrong/missing credential, revoked credential, instance replacement, `not_found`, `scope_denied`, and message `reconcile_required` with `details.reason=resume_from_canonical_state`.

```ts
await client.listConversationMessages('conversation/one', {
  limit: 25,
  cursor: 'eyJ2IjoxfQ',
});

expect(requestedUrl).toBe(
  'http://127.0.0.1:3020/api/client/v1/conversations/conversation%2Fone/messages?limit=25&cursor=eyJ2IjoxfQ',
);
```

- [ ] **Step 2: Run the discovered tests and verify failure**

Run:

```bash
corepack pnpm@10.34.0 exec vitest run tests/cave-discovery-pairing.spec.ts tests/cave-canonical-reads.spec.ts
```

Expected: failure because discovered transport methods are absent.

- [ ] **Step 3: Implement safe query and route construction**

Use `URLSearchParams` with deterministic `limit` then `cursor` insertion. Use encoded conversation IDs for path segments. Route through the existing `requestJson(..., { requireBearer: true })` path so discovery validation, stored-instance proof, exact invalidation, deadlines, redirect refusal, body bounds, and bearer attachment remain centralized.

Do not add arbitrary paths, methods, headers, or a generic fetch escape hatch. Do not route the legacy `familiars()` method through the new paged API.

- [ ] **Step 4: Run the complete Cave security suite**

Run:

```bash
corepack pnpm@10.34.0 exec vitest run tests/cave-canonical-reads.spec.ts tests/cave-discovery-pairing.spec.ts tests/cave-internals.spec.ts tests/client-contract.spec.ts tests/cave-familiars.spec.ts
corepack pnpm@10.34.0 typecheck
corepack pnpm@10.34.0 lint
```

Expected: canonical and existing pairing/credential suites pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add packages/cave/src/canonical-reads.ts packages/cave/src/pairing.ts tests/cave-canonical-reads.spec.ts tests/cave-discovery-pairing.spec.ts
git commit -m "feat: add discovered Cave canonical reads" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Add bounded Cave iterators and packed public-contract coverage

**Files:**
- Modify: `packages/cave/src/client.ts`
- Modify: `packages/cave/src/index.ts`
- Modify: `tests/cave-canonical-reads.spec.ts`
- Modify: `tests/client-contract.spec.ts`
- Modify: `tests/public-contract.spec.ts`
- Modify: `tests/packed-package.spec.ts`
- Modify: `tests/cave-contract-fixture.spec.ts`

- [ ] **Step 1: Write failing iterator and packed-consumer tests**

Add `iterateFamiliars`, `iterateProjects`, `iterateConversations`, and `iterateConversationMessages`. Test empty, exact one page, multiple pages, explicit `maxPages`, signal-only bounds, abort between pages, no implicit whole-corpus download, repeated cursor refusal, and propagation of `reconcile_required`.

```ts
await expect(
  Array.fromAsync(client.iterateProjects({ maxPages: 2, limit: 100 })),
).resolves.toHaveLength(150);

expect(transport.listProjects).toHaveBeenCalledTimes(2);
```

Packed tests must import these methods and public types from the package root with no source checkout or deep import.

- [ ] **Step 2: Run focused iterator and packed tests and verify failure**

Run:

```bash
corepack pnpm@10.34.0 exec vitest run tests/cave-canonical-reads.spec.ts tests/client-contract.spec.ts tests/public-contract.spec.ts tests/packed-package.spec.ts tests/cave-contract-fixture.spec.ts
```

Expected: failure because iterator methods and packed signatures are missing.

- [ ] **Step 3: Implement Cave iterator wrappers**

Each wrapper delegates to `iteratePages` and its corresponding one-page method. Preserve the operation signal, limit, cursor, and max-page bound. Do not add iteration for the single-item detail route.

Verify fixture limits remain `defaultPageSize: 50`, `maxPageSize: 100`, and bounded cursor characters. If the current vendored fixture differs from producer `main`, refresh only through the repository's contract import workflow and record provenance.

- [ ] **Step 4: Run packed and full affected checks**

Run:

```bash
corepack pnpm@10.34.0 exec vitest run tests/pagination.spec.ts tests/cave-canonical-reads.spec.ts tests/client-contract.spec.ts tests/public-contract.spec.ts tests/packed-package.spec.ts tests/cave-contract-fixture.spec.ts
corepack pnpm@10.34.0 verify:contracts
corepack pnpm@10.34.0 verify:package
corepack pnpm@10.34.0 typecheck
corepack pnpm@10.34.0 lint
```

Expected: packed root imports and contract limits pass.

- [ ] **Step 5: Commit Task 4**

```bash
git add packages/cave/src/client.ts packages/cave/src/index.ts tests/cave-canonical-reads.spec.ts tests/client-contract.spec.ts tests/public-contract.spec.ts tests/packed-package.spec.ts tests/cave-contract-fixture.spec.ts
git commit -m "feat: bound Cave canonical iteration" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Finish documentation, verification, review, PR, and evidence

**Files:**
- Modify: `packages/cave/README.md`
- Modify: `packages/cave/CHANGELOG.md`
- Modify: `packages/core/README.md`
- Modify: `packages/core/CHANGELOG.md`
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/superpowers/plans/2026-08-22-sdk-0.1-delivery-program.md`

- [ ] **Step 1: Document the exact supported surface**

Document:

- the five one-page methods and four bounded iterators;
- default/max page sizes and rejection rather than clamping;
- cursor opacity and no semantic decoding;
- route ordering and mutable conversation/message limitations;
- `reconcile_required` as a canonical reload instruction, never an automatic retry;
- explicit `maxPages` or signal requirement;
- existing legacy Familiar Contract/analytics methods as a separate extension surface;
- current instance preflight as defense in depth, with atomic producer binding still tracked by `OpenCoven/coven-cave#4996`.

- [ ] **Step 2: Run exact full verification**

Run:

```bash
git diff --check
corepack pnpm@10.34.0 verify
```

Expected: all tests, coverage thresholds, builds, contract/package/release checks, stress seeds, and lint pass.

- [ ] **Step 3: Request exact-SHA spec and code-quality review**

Review the full branch against SDK #36 and the producer route contract. Fix every correctness, security, pagination, compatibility, and documentation finding; rerun `corepack pnpm@10.34.0 verify` after the final fix.

- [ ] **Step 4: Commit final docs and review fixes**

```bash
git add README.md packages/core/README.md packages/core/CHANGELOG.md packages/cave/README.md packages/cave/CHANGELOG.md docs/ROADMAP.md docs/superpowers/plans/2026-08-22-sdk-0.1-delivery-program.md
git commit -m "docs: describe Cave canonical reads" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

- [ ] **Step 5: Push, open, verify, and merge**

Push `feat/cave-canonical-reads`, open a PR to `main`, include the exact verified SHA and test evidence, wait for required Node CI and CodeQL, merge only if GitHub still reports that exact head, then verify protected `main`.

- [ ] **Step 6: Record evidence and clean the branch**

Update SDK #36, Chat #27, SDK #38, and the Phase 1 tracker with the PR, reviewed head, merge commit, required checks, test count, coverage, and remaining blockers. Remove the merged local/remote branch and worktree only after merge evidence is verified.
