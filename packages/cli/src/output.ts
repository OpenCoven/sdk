const SENSITIVE_KEY_PATTERN = /^(?:authorization|bearer|cookie|pairing(?:_|-)?secret|password|secret|token|stack)$/iu;

export interface CliError {
  code: string;
  message: string;
  retryable?: boolean;
  action?: string;
  details?: Record<string, unknown>;
}

export interface CliCheck {
  id: string;
  status: 'ok' | 'error' | 'skipped';
  summary: string;
  data?: Record<string, unknown>;
  error?: CliError;
}

export interface CliOutput {
  command: string;
  data?: Record<string, unknown>;
  error?: CliError;
  human?: readonly string[];
  ok: boolean;
  version: string;
}

export interface CliErrorContext {
  system: 'cave' | 'coven' | 'secure-store' | 'cli';
  operation: string;
}

export function createCliError(
  code: string,
  message: string,
  options: {
    action?: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
  } = {},
): CliError {
  return {
    code,
    message,
    ...(typeof options.retryable === 'boolean' ? { retryable: options.retryable } : {}),
    ...(options.action === undefined ? {} : { action: options.action }),
    ...(options.details === undefined ? {} : { details: options.details }),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ownData(value: unknown, key: string): unknown {
  if (!isObject(value)) {
    return undefined;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function safeDetailsFrom(value: unknown): Record<string, unknown> | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const details: Record<string, unknown> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (candidate === undefined || key === 'cause' || key === 'stack') {
      continue;
    }
    if (
      typeof candidate === 'string' ||
      typeof candidate === 'number' ||
      typeof candidate === 'boolean' ||
      candidate === null
    ) {
      details[key] = candidate;
    }
  }

  return Object.keys(details).length === 0 ? undefined : details;
}

function extractCliDetails(error: unknown): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {};
  const details = safeDetailsFrom(ownData(error, 'details'));
  const diagnostics = safeDetailsFrom(ownData(error, 'diagnostics'));

  if (details !== undefined) {
    Object.assign(merged, details);
  }
  if (diagnostics !== undefined) {
    Object.assign(merged, diagnostics);
  }

  return Object.keys(merged).length === 0 ? undefined : merged;
}

function inferredRetryable(code: string): boolean | undefined {
  switch (code) {
    case 'not_found':
    case 'command_failed':
    case 'connect_failure':
    case 'credential_update_in_progress':
    case 'timeout':
      return true;
    case 'secure_store_unavailable':
    case 'incompatible_version':
    case 'platform_security_unavailable':
    case 'pairing_denied':
    case 'pairing_expired':
    case 'owner_mismatch':
    case 'unsafe_endpoint':
    case 'secret_store_rollback_failed':
    case 'reconcile_required':
      return false;
    default:
      return undefined;
  }
}

function secureStoreAction(): string {
  return 'Enable the platform secure-store backend for this user session and retry.';
}

function messageForCode(code: string, context: CliErrorContext): string {
  switch (code) {
    case 'not_found':
      if (context.system === 'cave' && context.operation === 'discover') {
        return 'Cave runtime discovery metadata was not found.';
      }
      if (context.system === 'coven' && context.operation === 'discover') {
        return 'Coven runtime discovery metadata was not found.';
      }
      if (context.system === 'coven') {
        return 'Coven daemon was not found.';
      }
      return 'The requested resource was not found.';
    case 'command_failed':
      return 'Coven discovery command did not complete successfully.';
    case 'malformed_config':
      return 'Coven discovery metadata was malformed.';
    case 'owner_mismatch':
      if (context.system === 'coven') {
        return 'The discovered Coven runtime is not owned by the current user.';
      }
      return 'The discovered Cave runtime is not owned by the current user.';
    case 'unsafe_endpoint':
      if (context.system === 'coven') {
        return 'The discovered Coven runtime endpoint could not be validated safely.';
      }
      return 'The discovered Cave runtime endpoint could not be validated safely.';
    case 'stale_record':
      return 'Cave runtime discovery metadata was stale.';
    case 'body_limit':
      return 'Runtime metadata exceeded the reviewed size limit.';
    case 'invalid_response':
      if (context.system === 'coven') {
        return 'The local Coven service returned malformed health data.';
      }
      return 'The local Cave service returned malformed data.';
    case 'connect_failure':
      return 'Could not connect to the Coven daemon.';
    case 'platform_security_unavailable':
      return context.system === 'coven'
        ? 'Required native Coven platform security is unavailable.'
        : context.system === 'cave'
          ? 'Required native Cave platform security is unavailable.'
        : 'Required native platform security is unavailable.';
    case 'timeout':
      if (context.system === 'coven') {
        return context.operation === 'discover'
          ? 'Coven runtime discovery timed out.'
          : 'The Coven daemon health check timed out.';
      }
      if (context.system === 'secure-store') {
        return context.operation === 'probe'
          ? 'The native secure credential storage health check timed out.'
          : 'The native secure credential storage operation timed out.';
      }
      if (context.system === 'cave') {
        return context.operation === 'discover'
          ? 'Cave runtime discovery timed out.'
          : 'The Cave operation timed out.';
      }
      return 'The operation timed out.';
    case 'aborted':
      return 'The operation was aborted.';
    case 'pairing_pending':
      return 'Cave pairing is still pending approval.';
    case 'pairing_denied':
      return 'Cave pairing request was denied.';
    case 'pairing_expired':
      return 'Cave pairing request expired before approval.';
    case 'incompatible_version':
      return 'The local Cave service requires a newer OpenCoven CLI version.';
    case 'secure_store_unavailable':
      return 'Native secure credential storage is unavailable.';
    case 'secret_store_write_failed':
      return 'The paired Cave credential could not be saved securely.';
    case 'secret_store_rollback_failed':
      return 'The paired Cave credential could not be rolled back safely.';
    case 'credential_update_in_progress':
      return 'A Cave credential update is still in progress.';
    case 'reconcile_required':
      return 'The local Cave authority changed and the stored credential is no longer trusted.';
    case 'scope_denied':
      return 'The stored Cave credential is missing the required scope.';
    case 'service_unavailable':
      return context.system === 'coven'
        ? 'The Coven daemon is temporarily unavailable.'
        : 'The Cave service is temporarily unavailable.';
    case 'rate_limited':
      return 'The Cave service temporarily rate-limited the request.';
    case 'conflict':
      return 'The Cave pairing request was already consumed or invalidated.';
    case 'unsupported_operation':
      return 'The local service does not support this operation.';
    default:
      return 'OpenCoven command failed.';
  }
}

function actionForCode(code: string, context: CliErrorContext): string | undefined {
  switch (code) {
    case 'not_found':
      if (context.system === 'cave' && context.operation === 'discover') {
        return 'Start Cave or set COVEN_CAVE_HOME to the reviewed runtime directory.';
      }
      if (context.system === 'coven' && context.operation === 'discover') {
        return 'Start Coven or set COVEN_HOME to the reviewed runtime directory.';
      }
      if (context.system === 'coven') {
        return 'Start Coven and retry once the local daemon is listening.';
      }
      return undefined;
    case 'command_failed':
      return 'Run `coven config paths --json` as the current user and retry.';
    case 'malformed_config':
      return 'Update Coven to a reviewed build and retry.';
    case 'owner_mismatch':
    case 'unsafe_endpoint':
      return 'Repair the local runtime ownership or permissions and retry.';
    case 'stale_record':
      return 'Restart Cave so it can write fresh runtime discovery metadata.';
    case 'connect_failure':
      return 'Start Coven and retry once the local daemon is listening.';
    case 'platform_security_unavailable':
      return context.system === 'coven'
        ? 'Use a reviewed OpenCoven CLI/runtime that injects the required native Coven transport-security adapter for this platform and retry.'
        : context.system === 'cave'
          ? 'Use a reviewed OpenCoven CLI/runtime with native Windows Cave path ownership/ACL validation, or inject CliRuntime.cave.discovery.dependencies.windowsPathTrust, then retry.'
        : 'Use a reviewed runtime that injects the required native platform security adapter and retry.';
    case 'invalid_response':
      return 'Update the local service to a reviewed build and retry.';
    case 'pairing_pending':
      return 'Approve the pairing request in Cave and rerun `opencoven cave pair` before the request expires.';
    case 'pairing_denied':
    case 'pairing_expired':
    case 'conflict':
      return 'Start a new pairing request with `opencoven cave pair`.';
    case 'incompatible_version':
      return 'Upgrade the OpenCoven CLI to the minimum reviewed version and retry.';
    case 'secure_store_unavailable':
      return secureStoreAction();
    case 'secret_store_write_failed':
      return secureStoreAction();
    case 'secret_store_rollback_failed':
      return 'Run `opencoven cave forget` once secure credential storage is healthy, then pair again.';
    case 'credential_update_in_progress':
      return 'Retry once the local credential update finishes.';
    case 'reconcile_required':
      return 'Run `opencoven cave pair` to establish a fresh credential.';
    case 'scope_denied':
      return 'Create a new Cave pairing with the reviewed scopes and retry.';
    case 'service_unavailable':
      return 'Retry once the local service is healthy again.';
    case 'rate_limited':
      return 'Retry once Cave stops rate limiting requests.';
    default:
      return undefined;
  }
}

function causeOf(error: unknown): unknown {
  return ownData(error, 'cause');
}

export function normalizeCliError(error: unknown, context: CliErrorContext): CliError {
  const cause = causeOf(error);
  let code = asString(ownData(error, 'code')) ?? 'unknown';
  if (code === 'secret_store_write_failed' && asString(ownData(cause, 'code')) === 'secure_store_unavailable') {
    code = 'secure_store_unavailable';
  }
  const retryable = asBoolean(ownData(error, 'retryable')) ?? inferredRetryable(code);
  const details = extractCliDetails(error);
  const action = actionForCode(code, context);
  const options: {
    action?: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
  } = {
    ...(typeof retryable === 'boolean' ? { retryable } : {}),
    ...(action === undefined ? {} : { action }),
    ...(details === undefined ? {} : { details }),
  };

  return createCliError(
    code,
    messageForCode(code, context),
    options,
  );
}

function sanitizeCliValue(
  value: unknown,
  key: string | undefined,
  seen: WeakSet<object>,
): unknown {
  if (key === 'human' || key === 'cause' || key === 'stack') {
    return undefined;
  }

  if (key !== undefined && SENSITIVE_KEY_PATTERN.test(key)) {
    return '[REDACTED]';
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeCliValue(entry, undefined, seen));
  }

  if (typeof value !== 'object') {
    return undefined;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  const sanitized: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    const candidate = sanitizeCliValue(entryValue, entryKey, seen);
    if (candidate !== undefined) {
      sanitized[entryKey] = candidate;
    }
  }
  seen.delete(value);
  return sanitized;
}

function renderHumanLines(lines: readonly string[]): string {
  if (lines.length === 0) {
    return '\n';
  }

  const rendered = lines.join('\n');
  return lines[lines.length - 1] === '' ? rendered : `${rendered}\n`;
}

export function formatCliOutput(output: CliOutput, format: 'human' | 'json'): string {
  if (format === 'json') {
    const sanitized = sanitizeCliValue(output, undefined, new WeakSet<object>());
    return `${JSON.stringify(sanitized, null, 2)}\n`;
  }

  const lines = output.human ?? [output.error?.message ?? 'OpenCoven command failed.'];
  return renderHumanLines(lines);
}
