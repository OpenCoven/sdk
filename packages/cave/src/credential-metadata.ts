import {
  CAVE_PAIRING_SCOPES,
  type CaveCredentialMetadata,
  type CavePairingScope,
} from './schemas.js';
import { snapshotManagedResult } from './managed-snapshot.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CAVE_PAIRING_SCOPE_SET = new Set<string>(CAVE_PAIRING_SCOPES);
const CREDENTIAL_METADATA_FIELDS = [
  'id',
  'appName',
  'installationId',
  'scopes',
  'createdAt',
  'lastUsedAt',
  'revokedAt',
  'revocationReason',
] as const;

function dataRecord(value: unknown): Record<string, unknown> | undefined {
  const snapshot = snapshotManagedResult(value);
  return typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)
    ? snapshot as Record<string, unknown>
    : undefined;
}

function hasExactFields(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === CREDENTIAL_METADATA_FIELDS.length &&
    keys.every((key) =>
      (CREDENTIAL_METADATA_FIELDS as readonly string[]).includes(key),
    )
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function nullableTimestamp(value: unknown): value is number | null {
  return value === null || timestamp(value);
}

function scopes(value: unknown): CavePairingScope[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const parsed: CavePairingScope[] = [];
  for (const scope of value) {
    if (
      typeof scope !== 'string' ||
      !CAVE_PAIRING_SCOPE_SET.has(scope) ||
      parsed.includes(scope as CavePairingScope)
    ) {
      return undefined;
    }
    parsed.push(scope as CavePairingScope);
  }
  return parsed;
}

/**
 * The Client v1 credential metadata contract shared by direct and
 * managed-native pairing exchange paths.
 */
export function parseCaveCredentialMetadata(
  value: unknown,
): CaveCredentialMetadata | undefined {
  const credential = dataRecord(value);
  if (
    credential === undefined ||
    !hasExactFields(credential) ||
    !nonEmptyString(credential.id) ||
    !UUID_RE.test(credential.id) ||
    !nonEmptyString(credential.appName) ||
    !nonEmptyString(credential.installationId) ||
    !timestamp(credential.createdAt) ||
    !nullableTimestamp(credential.lastUsedAt) ||
    !nullableTimestamp(credential.revokedAt) ||
    (credential.revocationReason !== null &&
      !nonEmptyString(credential.revocationReason))
  ) {
    return undefined;
  }

  const parsedScopes = scopes(credential.scopes);
  if (parsedScopes === undefined) {
    return undefined;
  }

  return {
    id: credential.id,
    appName: credential.appName,
    installationId: credential.installationId,
    scopes: parsedScopes,
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt,
    revokedAt: credential.revokedAt,
    revocationReason: credential.revocationReason,
  };
}
