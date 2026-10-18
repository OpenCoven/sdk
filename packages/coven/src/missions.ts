import { randomUUID } from 'node:crypto';

import { runOperation, type OperationContext, type OperationDefaults, type OperationOptions } from '@opencoven/sdk-core';

import { CovenClientError, isCovenClientError, normalizeCovenError } from './client-errors.js';
import { integer, object } from './automations-read-validation.js';
import {
  CovenAutomationsClient, type CovenAutomationsTransport,
} from './automations.js';
import type { CovenAutomationEventsOptions } from './automations-events.js';
import {
  cancelCommitted, decodeMissionCommand, missionCancelRequest, missionSubmitRequest, submitCommitted,
  type CovenMissionCommandRequest, type CovenMissionRefusal,
} from './missions-commands.js';
import { decodeMissionGet, missionGetRequest } from './missions-get.js';
import {
  deriveMissionId, isAdoptionKey, missionIdShape,
  type CovenMissionCancellation, type CovenMissionFamiliarRef, type CovenMissionSubmitInput, type CovenMissionView,
} from './missions-view.js';

const SUBMIT_ACTION = 'coven.automations.mission.submit.v1';
const GET_ACTION = 'coven.automations.mission.get.v1';
const CANCEL_ACTION = 'coven.automations.mission.cancel.v1';
const ENVELOPE_ACTION = 'coven.automations.command.v1';
/** Resends of a submit or cancel whose outcome is unknown, after the first send. */
const RESENDS = 3;

export interface CovenMissionsClientOptions {
  /** The same transport `CovenAutomationsClient` uses; the built-in ones reach only the owner-only socket or pipe. */
  readonly transport: CovenAutomationsTransport;
  /**
   * Recorded as the origin of every mission command: 1–128 characters of
   * `[A-Za-z0-9._:@-]`, starting alphanumeric. It is never an authority grant;
   * the daemon takes the mission's principal from the transport.
   */
  readonly principalId: string;
  readonly operation?: OperationDefaults;
}

export interface CovenMissionCommandOptions extends OperationOptions {
  /**
   * Caller-owned idempotency key, 8–200 characters of `[A-Za-z0-9._:-]`
   * starting alphanumeric. Generated with `crypto.randomUUID()` when absent and
   * returned on the result. Store it: resending with the same key and input is
   * how an unknown outcome is reconciled.
   */
  readonly adoptionKey?: string;
  /** Optional 1–200 character correlation id, recorded with the command. */
  readonly correlationId?: string;
}

export interface CovenMissionSubmitResult {
  /** `replayed`: the key had already committed, and nothing launched again. */
  readonly outcome: 'committed' | 'replayed';
  readonly adoptionKey: string;
  readonly missionId: string;
  readonly occurrenceId: string;
  /** The state at the first commit. */
  readonly mission: CovenMissionView;
}

export interface CovenMissionCancelResult {
  readonly outcome: 'committed' | 'replayed';
  readonly adoptionKey: string;
  /** `lost_to_completion` means the mission completed; the client never infers otherwise. */
  readonly cancellation: CovenMissionCancellation;
  readonly mission: CovenMissionView;
}

export interface CovenMissionWatchOptions extends OperationOptions {
  /** Yield only views with a higher revision. */
  readonly afterRevision?: number;
  /** Drop and report any view whose principal or familiar differs from this binding. */
  readonly expect?: { readonly principalId: string; readonly familiar: CovenMissionFamiliarRef };
  /** Wait between reads that saw no change: 100–60 000 ms, default 1 000. */
  readonly pollIntervalMs?: number;
}

/** The daemon refused a mission command. Nothing was committed by this request. */
export class CovenMissionError extends CovenClientError {
  readonly conflictOutcome: 'committed' | 'rejected' | undefined;
  readonly currentRevision: number | undefined;

  constructor(refusal: CovenMissionRefusal, operation: string) {
    super(normalizeCovenError({ code: refusal.code, retryable: refusal.retryable, statusCode: refusal.httpStatus }, operation));
    this.name = 'CovenMissionError';
    this.conflictOutcome = refusal.conflictOutcome;
    this.currentRevision = refusal.currentRevision;
  }
}

/**
 * A submit reached the daemon, or may have, and no answer proved what
 * happened. Show "checking", call `get(missionId)`, and resubmit with the same
 * adoption key and input if it answers `NOT_FOUND`. Never show "nothing happened".
 */
export class CovenMissionUncertain extends CovenClientError {
  readonly adoptionKey: string;
  readonly missionId: string;

  constructor(adoptionKey: string, missionId: string, operation: string) {
    super(normalizeCovenError({ code: 'outcome_unknown', retryable: true }, operation));
    this.name = 'CovenMissionUncertain';
    this.adoptionKey = adoptionKey;
    this.missionId = missionId;
  }
}

/** A view for another principal or familiar arrived; it was not shown. */
export class CovenMissionContextMismatch extends CovenClientError {
  readonly missionId: string;

  constructor(missionId: string, operation: string) {
    super(normalizeCovenError({ code: 'context_mismatch' }, operation));
    this.name = 'CovenMissionContextMismatch';
    this.missionId = missionId;
  }
}

/** Resolves after `ms`, or rejects when `signal` aborts. Uses the global timer, so fake timers apply. */
function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => new DOMException('The watch was aborted.', 'AbortError');
    if (signal?.aborted === true) {
      reject(aborted());
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function failure(code: string, operation: string): never {
  throw new CovenClientError(normalizeCovenError({ code }, operation));
}

/** Own data properties of `options`, limited to `allowed`; `undefined` for anything else. */
function ownOptions(options: unknown, allowed: readonly string[]): Record<string, unknown> | undefined {
  try {
    if (!object(options)) return undefined;
    const copy: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(options)) {
      const descriptor = Object.getOwnPropertyDescriptor(options, key);
      if (typeof key !== 'string' || !allowed.includes(key) || descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value')) return undefined;
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    return undefined;
  }
}

function sameFamiliar(left: CovenMissionFamiliarRef, right: CovenMissionFamiliarRef): boolean {
  return left.rootId === right.rootId && left.revisionId === right.revisionId;
}

/**
 * Submits, observes and cancels one familiar mission (OpenCoven/coven#1313).
 * Every state it reports is the daemon's `MissionView`; it keeps no state of
 * its own and stores nothing.
 */
export class CovenMissionsClient {
  readonly #options: CovenMissionsClientOptions;
  readonly #automations: CovenAutomationsClient;

  constructor(options: CovenMissionsClientOptions) {
    this.#options = options;
    this.#automations = new CovenAutomationsClient({
      transport: options.transport,
      ...(options.operation === undefined ? {} : { operation: options.operation }),
    });
  }

  /** The mission id the daemon assigns to a submit with this adoption key. Pure. */
  static missionIdFor(adoptionKey: string): string {
    return deriveMissionId(adoptionKey) ?? failure('invalid_options', 'missions.missionIdFor');
  }

  async submit(input: CovenMissionSubmitInput, options: CovenMissionCommandOptions = {}): Promise<CovenMissionSubmitResult> {
    const operation = 'missions.submit';
    const { request, operationOptions } = this.#prepare(operation, options, (context) =>
      missionSubmitRequest(input, context, operation));
    const missionId = deriveMissionId(request.envelope.adoptionKey) as string;
    const answer = await this.#send(request, SUBMIT_ACTION, operation, operationOptions,
      () => new CovenMissionUncertain(request.envelope.adoptionKey, missionId, operation));
    const committed = submitCommitted(answer.result, request as typeof request & {
      readonly envelope: { readonly command: 'mission.submit.v1' };
    }) ?? new CovenMissionUncertain(request.envelope.adoptionKey, missionId, operation);
    if (committed instanceof CovenMissionUncertain) throw committed;
    return Object.freeze({ outcome: answer.outcome, adoptionKey: request.envelope.adoptionKey, ...committed });
  }

  async get(missionId: string, options: OperationOptions = {}): Promise<CovenMissionView> {
    const operation = 'missions.get';
    const owned = ownOptions(options, ['signal', 'timeoutMs', 'observer']);
    if (owned === undefined || !missionIdShape(missionId)) return failure('invalid_options', operation);
    const request = missionGetRequest(missionId);
    const read = this.#options.transport.readDefinitions?.bind(this.#options.transport);
    try {
      return await runOperation(
        { system: 'coven', operation },
        this.#operationOptions(owned as OperationOptions),
        async (context) => {
          if (read === undefined) return failure('unsupported_operation', operation);
          await this.#requireActions([GET_ACTION], context, operation);
          const response = await read(request, context);
          this.#checkContext(context, operation);
          const decoded = decodeMissionGet(response.status, response.body, missionId);
          if (decoded === undefined) return failure('invalid_response', operation);
          if (decoded.outcome === 'rejected') throw new CovenMissionError(decoded.error, operation);
          return decoded.mission;
        },
      );
    } catch (error) {
      if (error instanceof CovenMissionError) throw error;
      throw new CovenClientError(normalizeCovenError(error, operation));
    }
  }

  async cancel(
    missionId: string,
    input: { readonly reason?: string } = {},
    options: CovenMissionCommandOptions = {},
  ): Promise<CovenMissionCancelResult> {
    const operation = 'missions.cancel';
    const reason = ownOptions(input, ['reason']);
    if (reason === undefined) return failure('invalid_options', operation);
    const { request, operationOptions } = this.#prepare(operation, options, (context) =>
      missionCancelRequest(missionId, reason.reason, context, operation));
    const uncertain = () => new CovenClientError(normalizeCovenError({ code: 'outcome_unknown', retryable: true }, operation));
    const answer = await this.#send(request, CANCEL_ACTION, operation, operationOptions, uncertain);
    const committed = cancelCommitted(answer.result, missionId);
    if (committed === undefined) throw uncertain();
    return Object.freeze({ outcome: answer.outcome, adoptionKey: request.envelope.adoptionKey, ...committed });
  }

  /**
   * Yields the mission's view each time its revision increases, and ends after
   * the first terminal view. It reads the mission's occurrence stream and the
   * view; when neither changed it waits `pollIntervalMs` before reading again.
   * An expired event cursor re-reads the view once and resumes from it.
   * `timeoutMs` bounds each read, not the watch; end it with `signal` or `return()`.
   */
  watch(missionId: string, options: CovenMissionWatchOptions = {}): AsyncIterableIterator<CovenMissionView> {
    const operation = 'missions.watch';
    const owned = ownOptions(options, ['signal', 'timeoutMs', 'observer', 'afterRevision', 'expect', 'pollIntervalMs']);
    const expect = owned?.expect;
    if (owned === undefined || !missionIdShape(missionId) ||
      (owned.afterRevision !== undefined && !integer(owned.afterRevision, 0)) ||
      (owned.pollIntervalMs !== undefined && !integer(owned.pollIntervalMs, 100, 60_000)) ||
      (expect !== undefined && !(object(expect) && typeof expect.principalId === 'string' && object(expect.familiar) &&
        typeof expect.familiar.rootId === 'string' && typeof expect.familiar.revisionId === 'string'))) {
      return failure('invalid_options', operation);
    }
    const binding = expect as CovenMissionWatchOptions['expect'];
    const pollIntervalMs = (owned.pollIntervalMs) ?? 1_000;
    // `return()` aborts a read or wait in flight; the caller's signal still applies.
    const controller = new AbortController();
    const callerSignal = owned.signal as AbortSignal | undefined;
    const signal = callerSignal === undefined ? controller.signal : AbortSignal.any([controller.signal, callerSignal]);
    const readOptions = Object.fromEntries([['signal', signal], ...['timeoutMs', 'observer']
      .filter((key) => owned[key] !== undefined).map((key) => [key, owned[key]])]) as OperationOptions;
    let revision = (owned.afterRevision) ?? 0;
    let checkpoint: string | undefined;
    let occurrenceId: string | undefined;
    let done = false;
    let pending = false;
    /** The first read needs no change to look for; every later one waits for the stream to move. */
    let primed = true;

    const view = async (): Promise<CovenMissionView> => {
      const current = await this.get(missionId, readOptions);
      if (binding !== undefined && (current.principal.principalId !== binding.principalId ||
        !sameFamiliar(current.familiar, binding.familiar))) {
        throw new CovenMissionContextMismatch(missionId, operation);
      }
      if (occurrenceId !== undefined && current.occurrenceId !== occurrenceId) return failure('invalid_response', operation);
      occurrenceId = current.occurrenceId;
      return current;
    };
    /** Whether the occurrence stream moved since the last read. */
    const moved = async (): Promise<boolean> => {
      const query = {
        stream: { kind: 'occurrence', id: occurrenceId as string },
        ...(checkpoint === undefined ? {} : { checkpoint }),
      } as CovenAutomationEventsOptions;
      try {
        const page = await this.#automations.events(query, readOptions);
        checkpoint = page.checkpoint;
        return page.events.length > 0;
      } catch (error) {
        if (isCovenClientError(error) && error.code === 'CURSOR_EXPIRED') {
          // Resume from a fresh view rather than replaying a lost window.
          checkpoint = undefined;
          return true;
        }
        throw error;
      }
    };

    const finished = (): IteratorResult<CovenMissionView> => ({ done: true, value: undefined });
    return {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        if (done) return finished();
        if (pending) return failure('invalid_options', operation);
        pending = true;
        try {
          for (;;) {
            if (!primed) {
              while (!(await moved())) {
                if (done) return finished();
                await delay(pollIntervalMs, signal);
              }
            }
            primed = false;
            const current = await view();
            if (done) return finished();
            if (current.revision > revision) {
              revision = current.revision;
              done = current.terminal;
              return { done: false, value: current };
            }
            if (current.terminal) {
              done = true;
              return finished();
            }
          }
        } catch (error) {
          if (done) return finished();
          done = true;
          if (isCovenClientError(error)) throw error;
          if (signal.aborted) return failure('aborted', operation);
          throw new CovenClientError(normalizeCovenError(error, operation));
        } finally {
          pending = false;
        }
      },
      return() {
        done = true;
        controller.abort();
        return Promise.resolve(finished());
      },
      throw(error?: unknown) {
        done = true;
        controller.abort();
        return Promise.resolve().then(() => { throw error; });
      },
    };
  }

  #operationOptions(options: OperationOptions): OperationOptions {
    const observer = options.observer ?? this.#options.operation?.observer;
    return {
      ...this.#options.operation,
      ...options,
      timeoutMs: options.timeoutMs ?? this.#options.operation?.timeoutMs ?? 5_000,
      ...(observer === undefined ? {} : { observer }),
    };
  }

  #checkContext(context: OperationContext, operation: string): void {
    context.signal.throwIfAborted();
    if (context.deadline !== undefined && context.deadline <= performance.now()) failure('timeout', operation);
  }

  async #requireActions(actions: readonly string[], context: OperationContext, operation: string): Promise<void> {
    const advertised = await this.#automations.capabilities({
      signal: context.signal,
      ...(context.deadline === undefined ? {} : { timeoutMs: Math.max(1, Math.ceil(context.deadline - performance.now())) }),
    });
    this.#checkContext(context, operation);
    if (advertised.status !== 'available' || !actions.every((action) => advertised.actions.includes(action))) {
      failure('capability_unsupported', operation);
    }
  }

  #prepare(
    operation: string,
    options: CovenMissionCommandOptions,
    build: (context: { adoptionKey: string; principalId: string; correlationId?: string }) => CovenMissionCommandRequest,
  ): { request: CovenMissionCommandRequest; operationOptions: OperationOptions } {
    const owned = ownOptions(options, ['signal', 'timeoutMs', 'observer', 'adoptionKey', 'correlationId']);
    if (owned === undefined || (owned.adoptionKey !== undefined && !isAdoptionKey(owned.adoptionKey))) {
      return failure('invalid_options', operation);
    }
    const { adoptionKey, correlationId, ...operationOptions } = owned;
    const request = build({
      adoptionKey: (adoptionKey) ?? randomUUID(),
      principalId: this.#options.principalId,
      ...(correlationId === undefined ? {} : { correlationId: correlationId as string }),
    });
    return { request, operationOptions: operationOptions };
  }

  /**
   * Sends one command and resends it, with the same key and bytes, while the
   * answer is unknown, up to three times within the deadline. A typed refusal
   * throws `CovenMissionError`; an answer that never arrives throws `uncertain()`.
   */
  async #send(
    request: CovenMissionCommandRequest,
    action: string,
    operation: string,
    options: OperationOptions,
    uncertain: () => CovenClientError,
  ): Promise<{ outcome: 'committed' | 'replayed'; result: Readonly<Record<string, unknown>> }> {
    const send = this.#options.transport.sendCommand?.bind(this.#options.transport);
    // Once a request is handed to the transport, no failure proves it was not applied.
    let sent = false;
    try {
      return await runOperation({ system: 'coven', operation }, this.#operationOptions(options), async (context) => {
        if (send === undefined) return failure('unsupported_operation', operation);
        await this.#requireActions([ENVELOPE_ACTION, action], context, operation);
        for (let resend = 0; ; resend += 1) {
          sent = true;
          let answer: ReturnType<typeof decodeMissionCommand>;
          try {
            const response = await send(request, context);
            answer = decodeMissionCommand(response.status, response.body, request);
          } catch {
            answer = undefined;
          }
          if (answer?.outcome === 'rejected') throw new CovenMissionError(answer.error, operation);
          if (answer !== undefined) return answer;
          if (resend >= RESENDS || context.signal.aborted ||
            (context.deadline !== undefined && context.deadline <= performance.now())) throw uncertain();
        }
      });
    } catch (error) {
      if (error instanceof CovenMissionError) throw error;
      if (sent) throw uncertain();
      throw new CovenClientError(normalizeCovenError(error, operation));
    }
  }
}

export function createCovenMissionsClient(options: CovenMissionsClientOptions): CovenMissionsClient {
  return new CovenMissionsClient(options);
}
