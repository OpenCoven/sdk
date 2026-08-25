const DIAGNOSTIC_CHECK_IDS = [
  'cave.discovery',
  'cave.health',
  'secure-store',
  'coven.discovery',
  'coven.health',
] as const;
const DIAGNOSTIC_CHECK_LIMIT = 16;
const CAVE_CAPABILITIES = [
  'health',
  'pairing',
  'credentials',
  'familiars',
  'projects',
  'conversations',
  'conversation-messages',
  'cursors',
] as const;
const CAVE_OPERATIONS = [
  'health.read',
  'pairing.create',
  'pairing.poll',
  'pairing.exchange',
  'pairing.admin.list',
  'pairing.admin.decide',
  'credentials.admin.list',
  'credentials.admin.revoke',
  'familiars.list',
  'projects.list',
  'conversations.list',
  'conversations.read',
  'messages.list',
] as const;
const RUNTIME_PLATFORMS = new Set([
  'aix',
  'android',
  'darwin',
  'freebsd',
  'haiku',
  'linux',
  'openbsd',
  'sunos',
  'win32',
  'cygwin',
  'netbsd',
]);
const RUNTIME_ARCHITECTURES = new Set([
  'arm',
  'arm64',
  'ia32',
  'loong64',
  'mips',
  'mipsel',
  'ppc',
  'ppc64',
  'riscv64',
  's390',
  's390x',
  'x64',
]);
const SAFE_DIAGNOSTIC_CODES = [
  'aborted',
  'body_limit',
  'command_failed',
  'conflict',
  'connect_failure',
  'credential_update_in_progress',
  'frame_limit',
  'incompatible_version',
  'invalid_request',
  'invalid_response',
  'malformed_config',
  'not_found',
  'operation_in_progress',
  'owner_mismatch',
  'pairing_denied',
  'pairing_expired',
  'pairing_pending',
  'platform_security_unavailable',
  'rate_limited',
  'reconcile_required',
  'scope_denied',
  'secret_store_delete_failed',
  'secret_store_read_failed',
  'secret_store_rollback_failed',
  'secret_store_write_failed',
  'secure_store_unavailable',
  'service_unavailable',
  'stale_record',
  'timeout',
  'unknown',
  'unsafe_endpoint',
  'unsupported_operation',
] as const;
const safeDiagnosticCodeSet = new Set<string>(
  SAFE_DIAGNOSTIC_CODES,
);
const VERSION_RE = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/u;
const RUNTIME_VERSION_RE = /^v?\d{1,5}\.\d{1,5}\.\d{1,5}$/u;
const API_VERSION_RE = /^\d{1,5}\.\d{1,5}(?:\.\d{1,5})?$/u;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const OPENCOVEN_DIAGNOSTIC_VERSION = 1;

export type OpenCovenDiagnosticCheckId =
  (typeof DIAGNOSTIC_CHECK_IDS)[number];
export type OpenCovenDiagnosticCode =
  (typeof SAFE_DIAGNOSTIC_CODES)[number];
export type OpenCovenDiagnosticCapability =
  | (typeof CAVE_CAPABILITIES)[number]
  | 'event-cursor'
  | 'events'
  | 'sessions'
  | 'structured-errors';
export type OpenCovenDiagnosticOperation =
  (typeof CAVE_OPERATIONS)[number];
export type OpenCovenDiagnosticStatus = 'ok' | 'error' | 'skipped';
export type OpenCovenDiagnosticSkipReason =
  | 'deadline-expired'
  | 'dependency-failed';
export type OpenCovenDiagnosticSystem =
  | 'cave'
  | 'coven'
  | 'secure-store';
export type OpenCovenDiagnosticPhase =
  | 'credential-store'
  | 'discovery'
  | 'health';

export interface OpenCovenDiagnosticRuntimeInput {
  readonly name: 'node';
  readonly version: string;
  readonly platform: string;
  readonly architecture: string;
}

export type OpenCovenDiagnosticCheckInput =
  | {
      readonly id: 'cave.discovery';
      readonly status: 'ok';
      readonly discovery?: unknown;
    }
  | {
      readonly id: 'cave.health';
      readonly status: 'ok';
      readonly observedAt: string;
      readonly health: unknown;
    }
  | {
      readonly id: 'secure-store';
      readonly status: 'ok';
      readonly observedAt: string;
    }
  | {
      readonly id: 'coven.discovery';
      readonly status: 'ok';
      readonly discovery?: unknown;
    }
  | {
      readonly id: 'coven.health';
      readonly status: 'ok';
      readonly observedAt: string;
      readonly health: unknown;
    }
  | {
      readonly id: OpenCovenDiagnosticCheckId;
      readonly status: 'error';
      readonly error: unknown;
    }
  | {
      readonly id: OpenCovenDiagnosticCheckId;
      readonly status: 'skipped';
      readonly skipReason: OpenCovenDiagnosticSkipReason;
    };

export interface OpenCovenDiagnosticReportOptions {
  readonly generatedAt: string;
  readonly packageVersion: string;
  readonly runtime: OpenCovenDiagnosticRuntimeInput;
  readonly checks: readonly OpenCovenDiagnosticCheckInput[];
}

export interface OpenCovenDiagnosticEnvironment {
  readonly packageVersion: string;
  readonly runtime: 'node';
  readonly runtimeVersion: string;
  readonly platform: string;
  readonly architecture: string;
}

export interface OpenCovenDiagnosticFailure {
  readonly code: OpenCovenDiagnosticCode;
  readonly retryable: boolean;
  readonly diagnosticId?: string;
}

export interface OpenCovenDiagnosticFacts {
  readonly apiVersion?: string;
  readonly releaseVersion?: string;
  readonly instanceSuffix?: string;
  readonly pairingRequired?: boolean;
  readonly capabilities?: readonly OpenCovenDiagnosticCapability[];
  readonly operations?: readonly OpenCovenDiagnosticOperation[];
  readonly lastHealthyAt?: string;
  readonly backend?: 'native';
  readonly protocol?: 'coven.daemon.v1';
  readonly transport?: 'unix' | 'windows-named-pipe';
}

export interface OpenCovenDiagnosticCheck {
  readonly id: OpenCovenDiagnosticCheckId;
  readonly system: OpenCovenDiagnosticSystem;
  readonly phase: OpenCovenDiagnosticPhase;
  readonly status: OpenCovenDiagnosticStatus;
  readonly outcome?: 'discovered';
  readonly facts?: OpenCovenDiagnosticFacts;
  readonly error?: OpenCovenDiagnosticFailure;
  readonly skipReason?: OpenCovenDiagnosticSkipReason;
}

export interface OpenCovenDiagnosticSummary {
  readonly healthy: boolean;
  readonly ok: number;
  readonly error: number;
  readonly skipped: number;
}

export interface OpenCovenDiagnosticReport {
  readonly version: 1;
  readonly generatedAt: string;
  readonly environment: OpenCovenDiagnosticEnvironment;
  readonly checks: readonly OpenCovenDiagnosticCheck[];
  readonly summary: OpenCovenDiagnosticSummary;
}

export class OpenCovenDiagnosticError extends TypeError {
  readonly code = 'invalid_diagnostics';
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'OpenCovenDiagnosticError';
  }
}

function invalidDiagnostics(message: string): never {
  throw new OpenCovenDiagnosticError(message);
}

function ownData(value: unknown, key: PropertyKey): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined &&
      Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function ownArray(
  value: unknown,
  maximumLength: number,
): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(
      value,
      'length',
    );
    const length =
      lengthDescriptor !== undefined &&
      Object.hasOwn(lengthDescriptor, 'value') &&
      typeof lengthDescriptor.value === 'number'
        ? lengthDescriptor.value
        : undefined;
    if (
      length === undefined ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maximumLength
    ) {
      return undefined;
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== length + 1 ||
      keys.some((key) => typeof key !== 'string')
    ) {
      return undefined;
    }
    const entries: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(
        value,
        String(index),
      );
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        return undefined;
      }
      const entry: unknown = descriptor.value;
      entries.push(entry);
    }
    return entries;
  } catch {
    return undefined;
  }
}

function requiredString(
  value: unknown,
  pattern: RegExp,
  label: string,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 64 ||
    !pattern.test(value)
  ) {
    return invalidDiagnostics(`${label} was malformed.`);
  }
  return value;
}

function canonicalTimestamp(
  value: unknown,
  label: string,
): string {
  if (typeof value !== 'string' || value.length > 32) {
    return invalidDiagnostics(`${label} was malformed.`);
  }
  const parsed = new Date(value);
  if (
    !Number.isFinite(parsed.valueOf()) ||
    parsed.toISOString() !== value
  ) {
    return invalidDiagnostics(`${label} was malformed.`);
  }
  return value;
}

function checkMetadata(id: OpenCovenDiagnosticCheckId): {
  phase: OpenCovenDiagnosticPhase;
  system: OpenCovenDiagnosticSystem;
} {
  switch (id) {
    case 'cave.discovery':
      return { phase: 'discovery', system: 'cave' };
    case 'cave.health':
      return { phase: 'health', system: 'cave' };
    case 'secure-store':
      return {
        phase: 'credential-store',
        system: 'secure-store',
      };
    case 'coven.discovery':
      return { phase: 'discovery', system: 'coven' };
    case 'coven.health':
      return { phase: 'health', system: 'coven' };
  }
}

function isCheckId(
  value: unknown,
): value is OpenCovenDiagnosticCheckId {
  return (
    typeof value === 'string' &&
    (DIAGNOSTIC_CHECK_IDS as readonly string[]).includes(value)
  );
}

function approvedValues<const Value extends string>(
  value: unknown,
  allowlist: readonly Value[],
): readonly Value[] {
  const entries = ownArray(value, 64);
  if (entries === undefined) {
    return Object.freeze([]);
  }
  const advertised = new Set(
    entries.filter((entry): entry is string => typeof entry === 'string'),
  );
  return Object.freeze(
    allowlist.filter((entry) => advertised.has(entry)),
  );
}

function isDiagnosticCode(
  value: unknown,
): value is OpenCovenDiagnosticCode {
  return (
    typeof value === 'string' &&
    safeDiagnosticCodeSet.has(value)
  );
}

function diagnosticError(value: unknown): OpenCovenDiagnosticFailure {
  const rawCode = ownData(value, 'code');
  const rawRetryable = ownData(value, 'retryable');
  const rawDiagnosticId = ownData(value, 'diagnosticId');
  const code = isDiagnosticCode(rawCode) ? rawCode : 'unknown';
  const diagnosticId =
    typeof rawDiagnosticId === 'string' &&
    UUID_RE.test(rawDiagnosticId)
      ? rawDiagnosticId
      : undefined;
  return Object.freeze({
    code,
    retryable:
      typeof rawRetryable === 'boolean' ? rawRetryable : false,
    ...(diagnosticId === undefined ? {} : { diagnosticId }),
  });
}

function caveHealthFacts(
  health: unknown,
  observedAt: unknown,
): OpenCovenDiagnosticFacts {
  const rawApiVersion = ownData(health, 'apiVersion');
  const rawReleaseVersion = ownData(health, 'releaseVersion');
  const rawInstanceId = ownData(health, 'instanceId');
  const rawPairingRequired = ownData(health, 'pairingRequired');
  const apiVersion =
    typeof rawApiVersion === 'string' &&
    API_VERSION_RE.test(rawApiVersion)
      ? rawApiVersion
      : undefined;
  const releaseVersion =
    typeof rawReleaseVersion === 'string' &&
    VERSION_RE.test(rawReleaseVersion)
      ? rawReleaseVersion
      : undefined;
  const instanceSuffix =
    typeof rawInstanceId === 'string' && UUID_RE.test(rawInstanceId)
      ? rawInstanceId.slice(-8)
      : undefined;
  const lastHealthyAt = canonicalTimestamp(
    observedAt,
    'Diagnostic observation timestamp',
  );
  return Object.freeze({
    ...(apiVersion === undefined ? {} : { apiVersion }),
    ...(releaseVersion === undefined ? {} : { releaseVersion }),
    ...(instanceSuffix === undefined ? {} : { instanceSuffix }),
    ...(typeof rawPairingRequired === 'boolean'
      ? { pairingRequired: rawPairingRequired }
      : {}),
    capabilities: approvedValues(
      ownData(health, 'capabilities'),
      CAVE_CAPABILITIES,
    ),
    operations: approvedValues(
      ownData(health, 'operations'),
      CAVE_OPERATIONS,
    ),
    lastHealthyAt,
  });
}

function secureStoreFacts(
  observedAt: unknown,
): OpenCovenDiagnosticFacts {
  return Object.freeze({
    backend: 'native',
    lastHealthyAt: canonicalTimestamp(
      observedAt,
      'Diagnostic observation timestamp',
    ),
  });
}

function covenDiscoveryFacts(
  discovery: unknown,
): OpenCovenDiagnosticFacts | undefined {
  const protocol = ownData(discovery, 'protocol');
  const endpoint = ownData(discovery, 'endpoint');
  const kind = ownData(endpoint, 'kind');
  const transport =
    kind === 'unix'
      ? 'unix'
      : kind === 'windowsNamedPipe'
        ? 'windows-named-pipe'
        : undefined;
  if (protocol !== 'coven.daemon.v1' && transport === undefined) {
    return undefined;
  }
  return Object.freeze({
    ...(protocol === 'coven.daemon.v1' ? { protocol } : {}),
    ...(transport === undefined ? {} : { transport }),
  });
}

function covenHealthFacts(
  health: unknown,
  observedAt: unknown,
): OpenCovenDiagnosticFacts {
  const rawProtocol = ownData(health, 'apiVersion');
  const rawReleaseVersion = ownData(health, 'covenVersion');
  const rawCapabilities = ownData(health, 'capabilities');
  const capabilities: OpenCovenDiagnosticCapability[] = [];
  if (ownData(rawCapabilities, 'sessions') === true) {
    capabilities.push('sessions');
  }
  if (ownData(rawCapabilities, 'events') === true) {
    capabilities.push('events');
  }
  if (typeof ownData(rawCapabilities, 'eventCursor') === 'string') {
    capabilities.push('event-cursor');
  }
  if (ownData(rawCapabilities, 'structuredErrors') === true) {
    capabilities.push('structured-errors');
  }
  return Object.freeze({
    ...(rawProtocol === 'coven.daemon.v1'
      ? { protocol: rawProtocol }
      : {}),
    ...(typeof rawReleaseVersion === 'string' &&
    VERSION_RE.test(rawReleaseVersion)
      ? { releaseVersion: rawReleaseVersion }
      : {}),
    capabilities: Object.freeze(capabilities),
    lastHealthyAt: canonicalTimestamp(
      observedAt,
      'Diagnostic observation timestamp',
    ),
  });
}

function buildCheck(
  input: unknown,
): OpenCovenDiagnosticCheck {
  const id = ownData(input, 'id');
  const status = ownData(input, 'status');
  if (!isCheckId(id)) {
    return invalidDiagnostics(
      'OpenCoven diagnostic check identifier was unsupported.',
    );
  }
  if (status !== 'ok' && status !== 'error' && status !== 'skipped') {
    return invalidDiagnostics(
      'OpenCoven diagnostic check status was malformed.',
    );
  }
  const metadata = checkMetadata(id);
  const base = {
    id,
    system: metadata.system,
    phase: metadata.phase,
    status,
  } as const;

  if (status === 'error') {
    return Object.freeze({
      ...base,
      error: diagnosticError(ownData(input, 'error')),
    });
  }
  if (status === 'skipped') {
    const skipReason = ownData(input, 'skipReason');
    return Object.freeze({
      ...base,
      skipReason:
        skipReason === 'deadline-expired'
          ? skipReason
          : 'dependency-failed',
    });
  }

  switch (id) {
    case 'cave.discovery':
      return Object.freeze({
        ...base,
        outcome: 'discovered',
      });
    case 'cave.health':
      return Object.freeze({
        ...base,
        facts: caveHealthFacts(
          ownData(input, 'health'),
          ownData(input, 'observedAt'),
        ),
      });
    case 'secure-store':
      return Object.freeze({
        ...base,
        facts: secureStoreFacts(ownData(input, 'observedAt')),
      });
    case 'coven.discovery': {
      const facts = covenDiscoveryFacts(ownData(input, 'discovery'));
      return Object.freeze({
        ...base,
        outcome: 'discovered',
        ...(facts === undefined ? {} : { facts }),
      });
    }
    case 'coven.health':
      return Object.freeze({
        ...base,
        facts: covenHealthFacts(
          ownData(input, 'health'),
          ownData(input, 'observedAt'),
        ),
      });
  }
}

function environment(
  options: unknown,
): OpenCovenDiagnosticEnvironment {
  const runtime = ownData(options, 'runtime');
  const packageVersion = requiredString(
    ownData(options, 'packageVersion'),
    VERSION_RE,
    'Diagnostic package version',
  );
  const runtimeVersion = requiredString(
    ownData(runtime, 'version'),
    RUNTIME_VERSION_RE,
    'Diagnostic runtime version',
  );
  const platform = ownData(runtime, 'platform');
  const architecture = ownData(runtime, 'architecture');
  if (
    ownData(runtime, 'name') !== 'node' ||
    typeof platform !== 'string' ||
    !RUNTIME_PLATFORMS.has(platform) ||
    typeof architecture !== 'string' ||
    !RUNTIME_ARCHITECTURES.has(architecture)
  ) {
    return invalidDiagnostics(
      'Diagnostic runtime metadata was malformed.',
    );
  }
  return Object.freeze({
    packageVersion,
    runtime: 'node',
    runtimeVersion,
    platform,
    architecture,
  });
}

export function createOpenCovenDiagnosticReport(
  options: OpenCovenDiagnosticReportOptions,
): OpenCovenDiagnosticReport {
  const checks = ownArray(
    ownData(options, 'checks'),
    DIAGNOSTIC_CHECK_LIMIT,
  );
  if (checks === undefined) {
    return invalidDiagnostics(
      'OpenCoven diagnostic checks must be bounded data entries.',
    );
  }
  const built = checks.map(buildCheck);
  const ids = built.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    return invalidDiagnostics(
      'OpenCoven diagnostic checks contained duplicate identifiers.',
    );
  }
  const summary = Object.freeze({
    healthy: built.every(({ status }) => status === 'ok'),
    ok: built.filter(({ status }) => status === 'ok').length,
    error: built.filter(({ status }) => status === 'error').length,
    skipped: built.filter(({ status }) => status === 'skipped').length,
  });
  return Object.freeze({
    version: OPENCOVEN_DIAGNOSTIC_VERSION,
    generatedAt: canonicalTimestamp(
      ownData(options, 'generatedAt'),
      'Diagnostic generation timestamp',
    ),
    environment: environment(options),
    checks: Object.freeze(built),
    summary,
  });
}
