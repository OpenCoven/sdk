import { normalizeError, type NormalizedError, type OpenCovenSystem } from './errors.js';

export type OperationEvent =
  | {
      phase: 'start';
      system: OpenCovenSystem;
      operation: string;
    }
  | {
      phase: 'success';
      system: OpenCovenSystem;
      operation: string;
      durationMs: number;
    }
  | {
      phase: 'failure' | 'timeout' | 'abort';
      system: OpenCovenSystem;
      operation: string;
      durationMs: number;
      error: NormalizedError;
    };

export interface OperationObserver {
  onEvent(event: OperationEvent): void;
  onObserverError(error: unknown, event: OperationEvent): void;
}

export function operationDuration(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt);
}

export function normalizeOperationEventError(
  error: unknown,
  system: OpenCovenSystem,
  operation: string,
): NormalizedError {
  return normalizeError(error, {
    system,
    operation,
  });
}

export function notifyOperationObserver(
  observer: OperationObserver | undefined,
  event: OperationEvent,
): void {
  if (observer === undefined) {
    return;
  }

  try {
    observer.onEvent(event);
  } catch (error) {
    observer.onObserverError(error, event);
  }
}
