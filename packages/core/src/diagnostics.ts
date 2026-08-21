import type { NormalizedError, OpenCovenSystem } from './errors.js';
import type { OperationEvent } from './operation-events.js';

/**
 * Diagnostics bundles.
 *
 * A support bundle is only worth producing if it is safe to paste into an
 * issue, so every field is copied through an allowlist rather than filtered
 * through a denylist. The difference matters when an input type grows a field:
 * an allowlist omits the new field until someone adds it deliberately, while a
 * denylist discloses it until someone remembers to forbid it.
 *
 * Never carried, by construction: prompts, message bodies, attachments,
 * credentials, and operation event payloads. Errors contribute their normalized
 * code rather than their prose, because prose is the one part of an error a
 * remote system can fill with arbitrary text.
 */

export const DIAGNOSTICS_SCHEMA = 'opencoven.diagnostics.v1';

/** Substituted for any host that is not a loopback literal. */
export const REDACTED_HOST = 'redacted';

const SYSTEMS: readonly OpenCovenSystem[] = ['cave', 'coven', 'sdk', 'cli'];
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
/**
 * A version must lead with a numeric release. A looser "word characters and
 * dashes" shape accepts `sk-live-...` as a version, which is exactly the value
 * a package map should never carry.
 */
const VERSION_PATTERN = /^\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]{1,32})?$/;
const RUNTIME_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const OPERATION_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface DiagnosticsRuntime {
  node?: string;
  platform?: string;
  arch?: string;
}

export interface DiagnosticsVersions {
  packages: Record<string, string>;
  runtime: DiagnosticsRuntime;
}

/** Per-system operation availability, as the client understands it. */
export type DiagnosticsCapabilities = Partial<
  Record<OpenCovenSystem, Record<string, boolean>>
>;

export interface DiagnosticsEndpointInput {
  label: string;
  url: string;
}

/**
 * What an endpoint looks like, not what it is.
 *
 * The host survives only when it is a loopback literal. Anything else is a name
 * someone chose -- a tailnet host, an internal DNS record -- and naming it in a
 * pasteable bundle discloses infrastructure for no diagnostic gain.
 * `credentialsInUrl` is reported because a credential in the URL is a common
 * misconfiguration, and a boolean says so without repeating the credential.
 */
export interface DiagnosticsEndpoint {
  label: string;
  protocol: string;
  host: string;
  port: number | null;
  loopback: boolean;
  credentialsInUrl: boolean;
  query: boolean;
}

export interface DiagnosticsOperationSummary {
  system: OpenCovenSystem;
  operation: string;
  started: number;
  succeeded: number;
  failed: number;
  timedOut: number;
  aborted: number;
  maxDurationMs: number | null;
  codes: string[];
}

/** A normalized error reduced to its non-prose fields. */
export interface DiagnosticsError {
  system: OpenCovenSystem;
  operation: string;
  code: string;
  retryable: boolean;
  requestId?: string;
  statusCode?: number;
}

export interface DiagnosticsBundle {
  schema: typeof DIAGNOSTICS_SCHEMA;
  versions: DiagnosticsVersions;
  capabilities: DiagnosticsCapabilities;
  discovery: DiagnosticsEndpoint[];
  operations: DiagnosticsOperationSummary[];
  errors: DiagnosticsError[];
}

export interface DiagnosticsInput {
  packages?: Readonly<Record<string, string>>;
  runtime?: DiagnosticsRuntime;
  capabilities?: DiagnosticsCapabilities;
  discovery?: readonly DiagnosticsEndpointInput[];
  events?: readonly OperationEvent[];
  errors?: readonly NormalizedError[];
}

interface OperationAccumulator {
  summary: DiagnosticsOperationSummary;
  codes: Set<string>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}

function isSystem(value: unknown): value is OpenCovenSystem {
  return SYSTEMS.includes(value as OpenCovenSystem);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/** Tolerate a caller that passed a non-array where a list was declared. */
function asArray<T>(value: readonly T[] | undefined): readonly T[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value as readonly T[];
}

/** Byte-order comparison. `localeCompare` would make output locale-dependent. */
function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function sortedEntries<T>(entries: [string, T][]): [string, T][] {
  return entries.sort(([left], [right]) => compareText(left, right));
}

function sanitizePackages(
  packages: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  if (!isObject(packages)) {
    return {};
  }

  return Object.fromEntries(
    sortedEntries(
      Object.entries(packages).filter(
        ([name, version]) =>
          matches(name, PACKAGE_NAME_PATTERN) && matches(version, VERSION_PATTERN),
      ),
    ),
  );
}

function sanitizeRuntime(runtime: DiagnosticsRuntime | undefined): DiagnosticsRuntime {
  if (!isObject(runtime)) {
    return {};
  }

  return {
    ...(matches(runtime.node, RUNTIME_PATTERN) ? { node: runtime.node } : {}),
    ...(matches(runtime.platform, RUNTIME_PATTERN) ? { platform: runtime.platform } : {}),
    ...(matches(runtime.arch, RUNTIME_PATTERN) ? { arch: runtime.arch } : {}),
  };
}

function sanitizeCapabilityGroup(group: unknown): Record<string, boolean> | undefined {
  if (!isObject(group)) {
    return undefined;
  }

  const entries: [string, boolean][] = [];

  for (const [name, value] of Object.entries(group)) {
    if (matches(name, OPERATION_PATTERN) && typeof value === 'boolean') {
      entries.push([name, value]);
    }
  }

  return entries.length === 0 ? undefined : Object.fromEntries(sortedEntries(entries));
}

function sanitizeCapabilities(
  capabilities: DiagnosticsCapabilities | undefined,
): DiagnosticsCapabilities {
  if (!isObject(capabilities)) {
    return {};
  }

  const sanitized: DiagnosticsCapabilities = {};

  for (const system of SYSTEMS) {
    const group = sanitizeCapabilityGroup(capabilities[system]);

    if (group !== undefined) {
      sanitized[system] = group;
    }
  }

  return sanitized;
}

/**
 * Reduce one endpoint to its shape.
 *
 * Returns undefined rather than a partial summary when the label or the URL
 * cannot be read: a bundle silently containing a half-parsed endpoint is harder
 * to trust than one that omits it.
 */
export function summarizeDiagnosticsEndpoint(
  endpoint: DiagnosticsEndpointInput,
): DiagnosticsEndpoint | undefined {
  if (!isObject(endpoint) || !matches(endpoint.label, LABEL_PATTERN)) {
    return undefined;
  }

  if (typeof endpoint.url !== 'string') {
    return undefined;
  }

  let parsed: URL;

  try {
    parsed = new URL(endpoint.url);
  } catch {
    return undefined;
  }

  const host = parsed.hostname.toLowerCase();
  const loopback = LOOPBACK_HOSTS.has(host);

  return {
    label: endpoint.label,
    protocol: parsed.protocol.replace(/:$/, ''),
    host: loopback ? host : REDACTED_HOST,
    port: parsed.port === '' ? null : Number(parsed.port),
    loopback,
    credentialsInUrl: parsed.username !== '' || parsed.password !== '',
    query: parsed.search !== '',
  };
}

/**
 * Reduce a normalized error to its non-prose fields.
 *
 * `message` is dropped rather than validated. The SDK-authored message is fully
 * derivable from `system` and `operation`, so keeping it would add nothing while
 * creating a field a hand-built error could fill with anything.
 */
export function sanitizeDiagnosticsError(error: NormalizedError): DiagnosticsError | undefined {
  if (!isObject(error) || !isSystem(error.system)) {
    return undefined;
  }

  if (!matches(error.operation, OPERATION_PATTERN) || !matches(error.code, CODE_PATTERN)) {
    return undefined;
  }

  const statusCode = error.statusCode;
  const keepStatusCode =
    typeof statusCode === 'number' &&
    Number.isInteger(statusCode) &&
    statusCode >= 100 &&
    statusCode <= 599;

  return {
    system: error.system,
    operation: error.operation,
    code: error.code,
    retryable: error.retryable === true,
    ...(matches(error.requestId, REQUEST_ID_PATTERN) ? { requestId: error.requestId } : {}),
    ...(keepStatusCode ? { statusCode } : {}),
  };
}

function createAccumulator(system: OpenCovenSystem, operation: string): OperationAccumulator {
  return {
    summary: {
      system,
      operation,
      started: 0,
      succeeded: 0,
      failed: 0,
      timedOut: 0,
      aborted: 0,
      maxDurationMs: null,
      codes: [],
    },
    codes: new Set<string>(),
  };
}

/**
 * Count operation events without retaining any of them.
 *
 * Events are the richest thing a caller can hand this module, and an event's
 * `error` is the only field on one that carries free text. Counts and
 * normalized codes answer what a support bundle is opened to answer -- did it
 * time out, how often, how slow -- without carrying a payload forward.
 */
export function summarizeOperationEvents(
  events: readonly OperationEvent[],
): DiagnosticsOperationSummary[] {
  const accumulators = new Map<string, OperationAccumulator>();

  for (const event of events) {
    if (!isObject(event) || !isSystem(event.system)) {
      continue;
    }

    if (!matches(event.operation, OPERATION_PATTERN)) {
      continue;
    }

    const key = `${event.system} ${event.operation}`;
    let accumulator = accumulators.get(key);

    if (accumulator === undefined) {
      accumulator = createAccumulator(event.system, event.operation);
      accumulators.set(key, accumulator);
    }

    const summary = accumulator.summary;

    if (event.phase === 'start') {
      summary.started += 1;
      continue;
    }

    if (typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)) {
      const durationMs = Math.round(event.durationMs);

      summary.maxDurationMs =
        summary.maxDurationMs === null ? durationMs : Math.max(summary.maxDurationMs, durationMs);
    }

    if (event.phase === 'success') {
      summary.succeeded += 1;
      continue;
    }

    if (event.phase === 'failure') {
      summary.failed += 1;
    } else if (event.phase === 'timeout') {
      summary.timedOut += 1;
    } else {
      summary.aborted += 1;
    }

    if (matches(event.error.code, CODE_PATTERN)) {
      accumulator.codes.add(event.error.code);
    }
  }

  const summaries = [...accumulators.values()].map((accumulator) => ({
    ...accumulator.summary,
    codes: [...accumulator.codes].sort(compareText),
  }));

  return summaries.sort((left, right) => {
    const system = compareText(left.system, right.system);

    return system === 0 ? compareText(left.operation, right.operation) : system;
  });
}

/** Assemble a bundle. Every field is allowlisted; unknown input is dropped. */
export function createDiagnosticsBundle(input: DiagnosticsInput = {}): DiagnosticsBundle {
  const source: DiagnosticsInput = isObject(input) ? input : {};

  return {
    schema: DIAGNOSTICS_SCHEMA,
    versions: {
      packages: sanitizePackages(source.packages),
      runtime: sanitizeRuntime(source.runtime),
    },
    capabilities: sanitizeCapabilities(source.capabilities),
    discovery: asArray(source.discovery)
      .map((endpoint) => summarizeDiagnosticsEndpoint(endpoint))
      .filter(isDefined),
    operations: summarizeOperationEvents(asArray(source.events)),
    errors: asArray(source.errors)
      .map((error) => sanitizeDiagnosticsError(error))
      .filter(isDefined),
  };
}
