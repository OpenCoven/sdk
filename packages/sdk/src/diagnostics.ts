import { CAVE_CLIENT_VERSION } from '@opencoven/cave-client';
import { COVEN_CLIENT_VERSION } from '@opencoven/coven-client';
import {
  createDiagnosticsBundle,
  type DiagnosticsBundle,
  type DiagnosticsCapabilities,
  type DiagnosticsEndpointInput,
  type DiagnosticsRuntime,
  type NormalizedError,
  type OperationEvent,
  type OperationObserver,
} from '@opencoven/sdk-core';

import type { OpenCovenHealthOptions, OpenCovenSdk } from './client.js';
import { OPENCOVEN_SDK_VERSION } from './version.js';

export interface OpenCovenDiagnosticsOptions extends OpenCovenHealthOptions {
  /** Merged over the package versions this build already knows. */
  packages?: Readonly<Record<string, string>>;
  runtime?: DiagnosticsRuntime;
  /** Endpoints to summarize. Only their shape reaches the bundle. */
  discovery?: readonly DiagnosticsEndpointInput[];
}

/**
 * Record every operation event while leaving the caller's observer intact.
 *
 * The event is recorded before the delegate sees it, so a delegate that throws
 * still contributes its event to the bundle -- the failure being diagnosed is
 * often the one whose observer blew up.
 */
function createRecordingObserver(
  delegate: OperationObserver | undefined,
  events: OperationEvent[],
): OperationObserver {
  return {
    onEvent(event: OperationEvent): void {
      events.push(event);
      delegate?.onEvent(event);
    },
    onObserverError(error: unknown, event: OperationEvent): void {
      if (delegate === undefined) {
        throw error;
      }

      delegate.onObserverError(error, event);
    },
  };
}

function healthOptionsFrom(
  options: OpenCovenDiagnosticsOptions,
  observer: OperationObserver,
): OpenCovenHealthOptions {
  return {
    observer,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.cave === undefined ? {} : { cave: options.cave }),
    ...(options.coven === undefined ? {} : { coven: options.coven }),
  };
}

/**
 * Client capabilities, read from the configured clients.
 *
 * A client that is not configured contributes no group at all, which is a
 * different claim from a group of falses: one says "not set up", the other says
 * "set up and unable".
 */
export function describeSdkCapabilities(sdk: OpenCovenSdk): DiagnosticsCapabilities {
  const capabilities: DiagnosticsCapabilities = {
    sdk: {
      health: true,
      healthReport: true,
      diagnostics: true,
    },
  };

  if (sdk.cave !== undefined) {
    const cave = sdk.cave.capabilities();

    capabilities.cave = {
      health: cave.health,
      familiars: cave.familiars,
      familiarContract: cave.familiarContract,
      familiarAnalytics: cave.familiarAnalytics,
    };
  }

  if (sdk.coven !== undefined) {
    const coven = sdk.coven.capabilities();

    capabilities.coven = {
      health: coven.health,
    };
  }

  return capabilities;
}

/**
 * Run a unified health check and reduce the result to a pasteable bundle.
 *
 * This is the only place the SDK turns live client state into diagnostics, and
 * it hands everything to `createDiagnosticsBundle` rather than formatting its
 * own: the sanitizing allowlist is worth exactly as much as the number of paths
 * that bypass it.
 */
export async function collectOpenCovenDiagnostics(
  sdk: OpenCovenSdk,
  options: OpenCovenDiagnosticsOptions = {},
): Promise<DiagnosticsBundle> {
  const events: OperationEvent[] = [];
  const report = await sdk.healthReport(
    healthOptionsFrom(options, createRecordingObserver(options.observer, events)),
  );
  const errors: NormalizedError[] = [];

  if (report.cave.status === 'unhealthy') {
    errors.push(report.cave.error.normalized);
  }

  if (report.coven.status === 'unhealthy') {
    errors.push(report.coven.error.normalized);
  }

  return createDiagnosticsBundle({
    packages: {
      '@opencoven/sdk': OPENCOVEN_SDK_VERSION,
      '@opencoven/cave-client': CAVE_CLIENT_VERSION,
      '@opencoven/coven-client': COVEN_CLIENT_VERSION,
      ...(options.packages ?? {}),
    },
    ...(options.runtime === undefined ? {} : { runtime: options.runtime }),
    capabilities: describeSdkCapabilities(sdk),
    ...(options.discovery === undefined ? {} : { discovery: options.discovery }),
    events,
    errors,
  });
}
