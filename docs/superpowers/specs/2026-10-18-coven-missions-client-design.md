# Coven missions client design

Status: **design approved with the producer contract on 2026-10-18 (Val); implemented in
`packages/coven/src/missions*.ts`**. See *As built* for where the code differs.

The SDK binding for the mission contract drafted in OpenCoven/coven#1314
(issue OpenCoven/coven#1313, design doc
`docs/architecture/coven-automations-missions.md`). Consumers: OpenCoven/chat#155,
and any owner-local client that needs to submit, watch or cancel one familiar
mission. This document changes no package and adds no Changeset. The client is
built once the producer's spec additions land in `coven.automations.v1`.

The producer's decisions that shape this client: M0 missions are read-only
diagnosis reports; `mission.submit` is one-shot only; and at most one mission
per familiar root and project is active, so the client surfaces
`CONCURRENCY_LIMIT` rather than queueing.

## Goal

One small client, `CovenMissionsClient`, in `@opencoven/coven`, beside
`CovenAutomationsClient`:

- **submit** one mission, idempotently, and survive a lost response;
- **get** and **watch** its authoritative state;
- **cancel** it idempotently;
- **refuse to show** a response that belongs to another principal, familiar or
  mission.

It invents no state. Every state and reason it exposes is the daemon's
`MissionView`. The daemon's flat actions are `coven.automations.mission.*.v1`,
behind the same owner-only gate as the other automations actions.

## Non-goals

- No mission logic in the client: no projection, retries of failed missions, or
  scheduling.
- No transport beyond the one `CovenAutomationsClient` already uses.
  Mission commands are owner-local only, and the client refuses a TCP base URL
  for them before sending.
- No persistence. The caller stores the adoption key and mission id. The client
  derives the id from the key so that a caller who stored only the key can
  re-attach.

## Surface

```ts
export class CovenMissionsClient {
  constructor(options: CovenMissionsClientOptions);      // same transport options as CovenAutomationsClient

  /** Derives the mission id the daemon will assign to this adoption key. Pure. */
  static missionIdFor(adoptionKey: string): string;      // "mission-" + first 32 hex of sha256(key)

  submit(input: MissionSubmitInput, options?: MissionCommandOptions): Promise<MissionSubmitResult>;
  get(missionId: string, options?: OperationOptions): Promise<MissionView>;
  cancel(missionId: string, input?: { reason?: string }, options?: MissionCommandOptions): Promise<MissionCancelResult>;
  watch(missionId: string, options?: MissionWatchOptions): AsyncIterable<MissionView>;
}

export interface MissionCommandOptions extends OperationOptions {
  /** Caller-owned. Generated with crypto.randomUUID() when absent, and returned on the result. */
  adoptionKey?: string;
}

export interface MissionWatchOptions extends OperationOptions {
  /** Yield only views with a higher revision. */
  afterRevision?: number;
  /** Drop and report any view whose principal or familiar differs from this binding. */
  expect?: { principalId: string; familiar: { rootId: string; revisionId: string } };
}
```

`MissionSubmitInput`, `MissionView`, `MissionState`, `MissionReason`,
`MissionResult` and `MissionCancelResult` are the coven types, generated from the
spec bundle once it carries them. They are not hand-written here.

## Behaviour

- **Submit with a lost response.**
  1. A transport failure after the request may have reached the daemon (a reset,
     a timeout, a 5xx without an envelope) is retried with the **same**
     adoption key and body, up to three times within the caller's deadline.
  2. A `replayed` response is success.
  3. If the outcome is still unknown, `submit` throws `CovenMissionUncertain`,
     carrying the key and `missionIdFor(key)`. The caller then shows
     "checking…" and calls `get`, never "nothing happened". This covers vectors
     M-01 and M-02.
- **Get** returns the view as given. `NOT_FOUND` is a typed error, never an empty
  view.
- **Watch.**
  1. It subscribes to the mission's occurrence stream through the existing
     `events.subscribe.v1` path.
  2. It yields a `MissionView` whenever `revision` increases.
  3. On `CURSOR_EXPIRED` it calls `get` once and resumes from the fresh view.
     This covers M-14.
  4. It ends after the first terminal view.
  5. If `expect` is set, any view that doesn't match is not yielded and raises
     `CovenMissionContextMismatch`. This covers M-11.
- **Cancel** carries its own adoption key, and a replay returns the same
  cancellation. The client never infers the outcome: `lost_to_completion` means
  the mission completed.
- **Errors**: one `CovenMissionError` with the daemon's `code`, `retryable` and
  `adoption` fields, plus the two client errors above. Messages never include
  the prompt, which is never echoed back anyway.

## Tests

- Client-side vectors from the producer doc:
  - **M-01**: id derivation, and `NOT_FOUND` before submit;
  - **M-02**: replay after a lost response, with exactly one commit observed by
    the fake daemon;
  - **M-11**: `expect` mismatch;
  - **M-14**: cursor expiry, then `get`.
- The producer's daemon vectors run against the daemon in coven's conformance
  suite, and against the SDK daemon canary once a coven release carries them.
- API baseline: the new exports are added intentionally, with a Changeset of
  `minor` for `@opencoven/coven`.

## How Chat uses it

Chat's native layer is Rust and must not open browser-direct HTTP (chat#155), so
Chat calls the producer's CLI (`coven missions … --json`) or its `coven-client`
crate rather than this TypeScript client. This client gives the other owner-local
clients the same contract and the same client-side vectors. The SDK's own
fixtures check that the CLI's JSON and `MissionView` agree.

## Release impact

None now. The client ships in a later minor of `@opencoven/coven`, after the
producer contract is approved and released. The packages are still unpublished
(#41).

## As built

- **The package is `@opencoven/coven-client`**, and the factory is
  `createCovenMissionsClient`, beside `createCovenAutomationsClient`.
- **The recorded principal is a client option.** Every command envelope needs
  `origin.principal`, so `CovenMissionsClientOptions` takes a `principalId`,
  recorded with each command and never an authority grant. Binding it once means
  a resend under the same key cannot change it.
- **No new error codes.** The producer kept the frozen v1 vocabulary: a stale
  revision is `REVISION_CONFLICT`, an envelope it does not enforce is
  `CAPABILITY_UNSUPPORTED`, and a past `validUntil` is `VALIDATION_FAILED`.
- **The transports carry missions.** `sendCommand` and `readDefinitions` accept
  mission requests, and the built-in Unix and Windows transports rebuild each one
  from its own data fields before sending, as they do for lifecycle commands.

## Open questions, resolved

1. **`watch` polls.** An `events.subscribe.v1` read returns one page and ends on
   an empty one, so the subscription has no liveness of its own. `watch` re-reads
   the view when the occurrence stream moves, and waits `pollIntervalMs` (default
   1 000 ms) between reads that saw no change.
2. **Three resends is fixed.** The caller bounds the total with its deadline.
