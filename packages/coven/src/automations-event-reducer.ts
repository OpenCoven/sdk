import { canonicalAutomationJson, snapshotAutomationJson, type AutomationJson } from './automations-canonical-json.js';
import { isAutomationEvent, type CovenAutomationEvent, type CovenAutomationEventStream } from './automations-events.js';
import { automationJsonDigest } from './automations-integrity.js';
import { integer, object } from './automations-read-validation.js';

export type CovenAutomationProjectionJson = AutomationJson;
type ReductionFailure = 'INVALID_EVENTS' | 'EVENT_ID_CONFLICT' | 'STREAM_MISMATCH' | 'STREAM_OUT_OF_ORDER' |
  'EVENT_INTEGRITY_MISMATCH' | 'OCCURRENCE_STATE_MISMATCH' | 'OCCURRENCE_TERMINAL_REGRESSION';
export type CovenAutomationEventReduction =
  | { readonly status: 'projected'; readonly stream: CovenAutomationEventStream | null; readonly cursor: number | null;
    readonly state: CovenAutomationProjectionJson; readonly stateDigest: `sha256:${string}`;
    readonly occurrenceContinuity: 'checked' | 'unavailable'; readonly authority: 'unverified' }
  | { readonly status: 'invalid'; readonly reason: ReductionFailure };

const terminal = new Set(['succeeded', 'failed', 'cancelled', 'timed_out', 'skipped', 'superseded']);
const invalid = (reason: ReductionFailure): CovenAutomationEventReduction => Object.freeze({ status: 'invalid', reason });

function payloadState(event: CovenAutomationEvent): Record<string, unknown> {
  const payload = event.payload;
  switch (event.kind) {
    case 'occurrence.transitioned': case 'run.transitioned': case 'attempt.transitioned':
      return { entity: event.payload.entity, state: event.payload.to };
    case 'occurrence.misfire_recorded': return { entity: 'occurrence', misfire: payload };
    case 'receipt.recorded': return { entity: 'receipt', receipt: payload };
    case 'feed.snapshot': return event.payload.state;
    default: return { entity: 'definition', revision: event.payload.revision,
      ...(event.payload.lifecycleState === undefined ? {} : { state: event.payload.lifecycleState }),
      ...(event.payload.definitionDigest === undefined ? {} : { definitionDigest: event.payload.definitionDigest }) };
  }
}

/** Bounded supplied-batch reference projection; no persistence, transport or execution authority. */
export function reduceAutomationEvents(events: unknown): CovenAutomationEventReduction {
  const owned = snapshotAutomationJson(events, 'jcs');
  if (!Array.isArray(owned)) return invalid('INVALID_EVENTS');
  let stream: CovenAutomationEventStream | null = null;
  let cursor: number | null = null;
  let state: AutomationJson = null;
  let checked = false;
  let unavailable = false;
  const seen = new Map<string, string>();
  for (const entry of owned as readonly AutomationJson[]) {
    if (!isAutomationEvent(entry)) return invalid('INVALID_EVENTS');
    if (entry.integrity !== undefined && automationJsonDigest(entry, true) !== entry.integrity.value) return invalid('EVENT_INTEGRITY_MISMATCH');
    const serialized = canonicalAutomationJson(entry);
    const prior = seen.get(entry.eventId);
    if (prior !== undefined) {
      if (prior !== serialized) return invalid('EVENT_ID_CONFLICT');
      continue;
    }
    if (stream !== null && (entry.stream.kind !== stream.kind || entry.stream.id !== stream.id)) return invalid('STREAM_MISMATCH');
    stream ??= entry.stream;
    if (entry.kind === 'feed.snapshot') {
      if (entry.sequence !== entry.payload.throughSequence || entry.sequence <= (cursor ?? -1)) return invalid('STREAM_OUT_OF_ORDER');
      state = entry.payload.state as AutomationJson;
    } else {
      if (cursor === Number.MAX_SAFE_INTEGER || entry.sequence !== (cursor ?? -1) + 1) return invalid('STREAM_OUT_OF_ORDER');
      if (stream.kind === 'occurrence' && entry.kind === 'occurrence.transitioned') {
        const from = object(state) && state.entity === 'occurrence' && typeof state.state === 'string' ? state.state : undefined;
        if (from === undefined) unavailable = true;
        else {
          checked = true;
          if (entry.payload.from !== from) return invalid('OCCURRENCE_STATE_MISMATCH');
          if (terminal.has(from)) return invalid('OCCURRENCE_TERMINAL_REGRESSION');
        }
      }
      const window: Record<string, unknown> | undefined = object(state) && object(state.eventWindow) ? state.eventWindow : undefined;
      const firstSequence: number = integer(window?.firstSequence, 0) ? window.firstSequence : entry.sequence;
      state = Object.freeze({ ...payloadState(entry), eventWindow: Object.freeze({ firstSequence, lastSequence: entry.sequence }) });
    }
    cursor = entry.sequence;
    seen.set(entry.eventId, serialized);
  }
  return Object.freeze({ status: 'projected', stream, cursor, state, stateDigest: `sha256:${automationJsonDigest(state)}`,
    occurrenceContinuity: checked && !unavailable ? 'checked' : 'unavailable', authority: 'unverified' });
}
