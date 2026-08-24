import { createHash } from 'node:crypto';

export interface CaveContractCursor {
  current: string;
  hasMore: boolean;
  next: string;
}

export interface CaveContractIdentity {
  displayName: string;
  id: string;
  kind: string;
}

export interface CaveContractRevision {
  token: string;
  updatedAt: string;
}

export interface CaveContractOperation {
  families: readonly string[];
  id: string;
  ingress: string;
  method: string;
  path: string;
  scope: string | null;
}

export interface CaveContractPublicRoute {
  method: string;
  path: string;
}

export interface CaveContractEnvelopeMetadata {
  apiVersion: string;
  capabilities: readonly string[];
  minimumClientVersion: string;
  operations: readonly string[];
  requestId?: string;
}

export interface CaveContractHealthData {
  instanceId: string;
  pairingRequired: boolean;
  releaseVersion: string;
}

export interface CaveContractPairingStatusData {
  expiresAt: number;
  id: string;
  status: string;
}

export interface CaveContractPairingCreatedData {
  expiresAt: number;
  requestId: string;
  secret: string;
}

export interface CaveContractPairingExchangeData {
  bearer: string;
  credential: {
    appName: string;
    createdAt: number;
    id: string;
    installationId: string;
    lastUsedAt: number | null;
    revocationReason: string | null;
    revokedAt: number | null;
    scopes: readonly string[];
  };
}

export interface CaveContractFixture {
  contract: {
    apiVersion: string;
    capabilities: readonly string[];
    discovery: {
      fileName: string;
      mode: string;
      version: number;
    };
    errorCodes: readonly string[];
    identityKinds: readonly string[];
    limits: {
      cursorCharacters: number;
      declarationIdCharacters: number;
      defaultPageSize: number;
      errorDetailEntries: number;
      errorDetailValueCharacters: number;
      errorMessageCharacters: number;
      idempotencyKeyCharacters: number;
      instanceIdCharacters: number;
      maxPageSize: number;
      releaseVersionCharacters: number;
      requestIdCharacters: number;
      revisionTokenCharacters: number;
    };
    minimumClientVersion: string;
    operations: readonly CaveContractOperation[];
    pairingRequired: boolean;
    pairingScopes: readonly string[];
    pairingSecretHeader: string;
    publicRoutes: readonly CaveContractPublicRoute[];
  };
  examples: {
    cursor: CaveContractCursor;
    discoveryRecord: {
      endpoint: string;
      nonce: string;
      pid: number;
      startedAt: string;
      version: number;
    };
    errorEnvelope: CaveContractEnvelopeMetadata & {
      error: {
        code: string;
        details: Record<string, string>;
        message: string;
        retryable: boolean;
      };
      requestId: string;
    };
    health: CaveContractHealthData;
    healthEnvelope: CaveContractEnvelopeMetadata & {
      data: CaveContractHealthData;
    };
    identity: CaveContractIdentity;
    pairingCreatedEnvelope: CaveContractEnvelopeMetadata & {
      data: CaveContractPairingCreatedData;
    };
    pairingExchangeEnvelope: CaveContractEnvelopeMetadata & {
      data: CaveContractPairingExchangeData;
    };
    pairingStatusEnvelope: CaveContractEnvelopeMetadata & {
      data: CaveContractPairingStatusData;
    };
    revision: CaveContractRevision;
    status: {
      status: 'ok';
    };
    successEnvelope: CaveContractEnvelopeMetadata & {
      cursor: CaveContractCursor;
      data: {
        status: 'ok';
      };
      identity: CaveContractIdentity;
      requestId: string;
      revision: CaveContractRevision;
    };
  };
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toUtf8String(value: string | Uint8Array): string {
  return typeof value === 'string' ? value : Buffer.from(value).toString('utf8');
}

function normalizeDigest(value: string): string {
  const normalized = value.trim();

  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw new TypeError('Cave fixture digest must be a lowercase hexadecimal SHA-256 string.');
  }

  return normalized;
}

function expectObject(value: unknown, path: string): JsonObject {
  if (!isObject(value)) {
    throw new TypeError(`${path} must be an object.`);
  }

  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${path} must be a string.`);
  }

  return value;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${path} must be a boolean.`);
  }

  return value;
}

function expectInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`${path} must be a safe integer.`);
  }

  return value;
}

function expectNullableString(value: unknown, path: string): string | null {
  return value === null ? null : expectString(value, path);
}

function expectNullableInteger(value: unknown, path: string): number | null {
  return value === null ? null : expectInteger(value, path);
}

function expectOptionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : expectString(value, path);
}

function expectStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array.`);
  }

  return value.map((entry, index) => expectString(entry, `${path}[${index}]`));
}

function expectStringRecord(value: unknown, path: string): Record<string, string> {
  const record = expectObject(value, path);

  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      expectString(entry, `${path}.${key}`),
    ]),
  );
}

function parseCursor(value: unknown, path: string): CaveContractCursor {
  const cursor = expectObject(value, path);

  return {
    current: expectString(cursor.current, `${path}.current`),
    hasMore: expectBoolean(cursor.hasMore, `${path}.hasMore`),
    next: expectString(cursor.next, `${path}.next`),
  };
}

function parseIdentity(value: unknown, path: string): CaveContractIdentity {
  const identity = expectObject(value, path);

  return {
    displayName: expectString(identity.displayName, `${path}.displayName`),
    id: expectString(identity.id, `${path}.id`),
    kind: expectString(identity.kind, `${path}.kind`),
  };
}

function parseRevision(value: unknown, path: string): CaveContractRevision {
  const revision = expectObject(value, path);

  return {
    token: expectString(revision.token, `${path}.token`),
    updatedAt: expectString(revision.updatedAt, `${path}.updatedAt`),
  };
}

function parseStatus(value: unknown, path: string) {
  const status = expectObject(value, path);
  const parsedStatus = expectString(status.status, `${path}.status`);

  if (parsedStatus !== 'ok') {
    throw new TypeError(`${path}.status must be "ok".`);
  }

  return { status: parsedStatus } as const;
}

function parseEnvelopeMetadata(value: JsonObject, path: string): CaveContractEnvelopeMetadata {
  const requestId = expectOptionalString(value.requestId, `${path}.requestId`);

  return {
    apiVersion: expectString(value.apiVersion, `${path}.apiVersion`),
    capabilities: expectStringArray(value.capabilities, `${path}.capabilities`),
    minimumClientVersion: expectString(
      value.minimumClientVersion,
      `${path}.minimumClientVersion`,
    ),
    operations: expectStringArray(value.operations, `${path}.operations`),
    ...(requestId === undefined ? {} : { requestId }),
  };
}

function parseHealth(value: unknown, path: string): CaveContractHealthData {
  const health = expectObject(value, path);

  return {
    instanceId: expectString(health.instanceId, `${path}.instanceId`),
    pairingRequired: expectBoolean(health.pairingRequired, `${path}.pairingRequired`),
    releaseVersion: expectString(health.releaseVersion, `${path}.releaseVersion`),
  };
}

function parsePairingStatus(value: unknown, path: string): CaveContractPairingStatusData {
  const pairing = expectObject(value, path);

  return {
    expiresAt: expectInteger(pairing.expiresAt, `${path}.expiresAt`),
    id: expectString(pairing.id, `${path}.id`),
    status: expectString(pairing.status, `${path}.status`),
  };
}

function parsePairingCreated(value: unknown, path: string): CaveContractPairingCreatedData {
  const pairing = expectObject(value, path);

  return {
    expiresAt: expectInteger(pairing.expiresAt, `${path}.expiresAt`),
    requestId: expectString(pairing.requestId, `${path}.requestId`),
    secret: expectString(pairing.secret, `${path}.secret`),
  };
}

function parsePairingExchange(value: unknown, path: string): CaveContractPairingExchangeData {
  const pairing = expectObject(value, path);
  const credential = expectObject(pairing.credential, `${path}.credential`);

  return {
    bearer: expectString(pairing.bearer, `${path}.bearer`),
    credential: {
      appName: expectString(
        credential.appName,
        `${path}.credential.appName`,
      ),
      createdAt: expectInteger(
        credential.createdAt,
        `${path}.credential.createdAt`,
      ),
      id: expectString(credential.id, `${path}.credential.id`),
      installationId: expectString(
        credential.installationId,
        `${path}.credential.installationId`,
      ),
      lastUsedAt: expectNullableInteger(
        credential.lastUsedAt,
        `${path}.credential.lastUsedAt`,
      ),
      revocationReason: expectNullableString(
        credential.revocationReason,
        `${path}.credential.revocationReason`,
      ),
      revokedAt: expectNullableInteger(
        credential.revokedAt,
        `${path}.credential.revokedAt`,
      ),
      scopes: expectStringArray(
        credential.scopes,
        `${path}.credential.scopes`,
      ),
    },
  };
}

function parseErrorEnvelope(value: unknown, path: string) {
  const envelope = expectObject(value, path);
  const error = expectObject(envelope.error, `${path}.error`);

  return {
    ...parseEnvelopeMetadata(envelope, path),
    error: {
      code: expectString(error.code, `${path}.error.code`),
      details: expectStringRecord(error.details, `${path}.error.details`),
      message: expectString(error.message, `${path}.error.message`),
      retryable: expectBoolean(error.retryable, `${path}.error.retryable`),
    },
    requestId: expectString(envelope.requestId, `${path}.requestId`),
  };
}

function parseHealthEnvelope(value: unknown, path: string) {
  const envelope = expectObject(value, path);

  return {
    ...parseEnvelopeMetadata(envelope, path),
    data: parseHealth(envelope.data, `${path}.data`),
  };
}

function parsePairingEnvelope<T>(
  value: unknown,
  path: string,
  parseData: (data: unknown, dataPath: string) => T,
) {
  const envelope = expectObject(value, path);

  return {
    ...parseEnvelopeMetadata(envelope, path),
    data: parseData(envelope.data, `${path}.data`),
  };
}

function parseSuccessEnvelope(value: unknown, path: string) {
  const envelope = expectObject(value, path);

  return {
    ...parseEnvelopeMetadata(envelope, path),
    cursor: parseCursor(envelope.cursor, `${path}.cursor`),
    data: parseStatus(envelope.data, `${path}.data`),
    identity: parseIdentity(envelope.identity, `${path}.identity`),
    requestId: expectString(envelope.requestId, `${path}.requestId`),
    revision: parseRevision(envelope.revision, `${path}.revision`),
  };
}

function parseOperation(value: unknown, path: string): CaveContractOperation {
  const operation = expectObject(value, path);

  return {
    families: expectStringArray(operation.families, `${path}.families`),
    id: expectString(operation.id, `${path}.id`),
    ingress: expectString(operation.ingress, `${path}.ingress`),
    method: expectString(operation.method, `${path}.method`),
    path: expectString(operation.path, `${path}.path`),
    scope: expectNullableString(operation.scope, `${path}.scope`),
  };
}

function parsePublicRoute(value: unknown, path: string): CaveContractPublicRoute {
  const route = expectObject(value, path);

  return {
    method: expectString(route.method, `${path}.method`),
    path: expectString(route.path, `${path}.path`),
  };
}

function parseObjectArray<T>(
  value: unknown,
  path: string,
  parseEntry: (entry: unknown, entryPath: string) => T,
): T[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array.`);
  }

  return value.map((entry, index) => parseEntry(entry, `${path}[${index}]`));
}

function parseContractFixtureObject(value: unknown): CaveContractFixture {
  const fixture = expectObject(value, 'fixture');
  const contract = expectObject(fixture.contract, 'fixture.contract');
  const discovery = expectObject(contract.discovery, 'fixture.contract.discovery');
  const limits = expectObject(contract.limits, 'fixture.contract.limits');
  const examples = expectObject(fixture.examples, 'fixture.examples');
  const discoveryRecord = expectObject(
    examples.discoveryRecord,
    'fixture.examples.discoveryRecord',
  );

  return {
    contract: {
      apiVersion: expectString(contract.apiVersion, 'fixture.contract.apiVersion'),
      capabilities: expectStringArray(
        contract.capabilities,
        'fixture.contract.capabilities',
      ),
      discovery: {
        fileName: expectString(
          discovery.fileName,
          'fixture.contract.discovery.fileName',
        ),
        mode: expectString(discovery.mode, 'fixture.contract.discovery.mode'),
        version: expectInteger(discovery.version, 'fixture.contract.discovery.version'),
      },
      errorCodes: expectStringArray(contract.errorCodes, 'fixture.contract.errorCodes'),
      identityKinds: expectStringArray(
        contract.identityKinds,
        'fixture.contract.identityKinds',
      ),
      limits: {
        cursorCharacters: expectInteger(
          limits.cursorCharacters,
          'fixture.contract.limits.cursorCharacters',
        ),
        declarationIdCharacters: expectInteger(
          limits.declarationIdCharacters,
          'fixture.contract.limits.declarationIdCharacters',
        ),
        defaultPageSize: expectInteger(
          limits.defaultPageSize,
          'fixture.contract.limits.defaultPageSize',
        ),
        errorDetailEntries: expectInteger(
          limits.errorDetailEntries,
          'fixture.contract.limits.errorDetailEntries',
        ),
        errorDetailValueCharacters: expectInteger(
          limits.errorDetailValueCharacters,
          'fixture.contract.limits.errorDetailValueCharacters',
        ),
        errorMessageCharacters: expectInteger(
          limits.errorMessageCharacters,
          'fixture.contract.limits.errorMessageCharacters',
        ),
        idempotencyKeyCharacters: expectInteger(
          limits.idempotencyKeyCharacters,
          'fixture.contract.limits.idempotencyKeyCharacters',
        ),
        instanceIdCharacters: expectInteger(
          limits.instanceIdCharacters,
          'fixture.contract.limits.instanceIdCharacters',
        ),
        maxPageSize: expectInteger(
          limits.maxPageSize,
          'fixture.contract.limits.maxPageSize',
        ),
        releaseVersionCharacters: expectInteger(
          limits.releaseVersionCharacters,
          'fixture.contract.limits.releaseVersionCharacters',
        ),
        requestIdCharacters: expectInteger(
          limits.requestIdCharacters,
          'fixture.contract.limits.requestIdCharacters',
        ),
        revisionTokenCharacters: expectInteger(
          limits.revisionTokenCharacters,
          'fixture.contract.limits.revisionTokenCharacters',
        ),
      },
      minimumClientVersion: expectString(
        contract.minimumClientVersion,
        'fixture.contract.minimumClientVersion',
      ),
      operations: parseObjectArray(
        contract.operations,
        'fixture.contract.operations',
        parseOperation,
      ),
      pairingRequired: expectBoolean(
        contract.pairingRequired,
        'fixture.contract.pairingRequired',
      ),
      pairingScopes: expectStringArray(
        contract.pairingScopes,
        'fixture.contract.pairingScopes',
      ),
      pairingSecretHeader: expectString(
        contract.pairingSecretHeader,
        'fixture.contract.pairingSecretHeader',
      ),
      publicRoutes: parseObjectArray(
        contract.publicRoutes,
        'fixture.contract.publicRoutes',
        parsePublicRoute,
      ),
    },
    examples: {
      cursor: parseCursor(examples.cursor, 'fixture.examples.cursor'),
      discoveryRecord: {
        endpoint: expectString(
          discoveryRecord.endpoint,
          'fixture.examples.discoveryRecord.endpoint',
        ),
        nonce: expectString(
          discoveryRecord.nonce,
          'fixture.examples.discoveryRecord.nonce',
        ),
        pid: expectInteger(
          discoveryRecord.pid,
          'fixture.examples.discoveryRecord.pid',
        ),
        startedAt: expectString(
          discoveryRecord.startedAt,
          'fixture.examples.discoveryRecord.startedAt',
        ),
        version: expectInteger(
          discoveryRecord.version,
          'fixture.examples.discoveryRecord.version',
        ),
      },
      errorEnvelope: parseErrorEnvelope(
        examples.errorEnvelope,
        'fixture.examples.errorEnvelope',
      ),
      health: parseHealth(examples.health, 'fixture.examples.health'),
      healthEnvelope: parseHealthEnvelope(
        examples.healthEnvelope,
        'fixture.examples.healthEnvelope',
      ),
      identity: parseIdentity(examples.identity, 'fixture.examples.identity'),
      pairingCreatedEnvelope: parsePairingEnvelope(
        examples.pairingCreatedEnvelope,
        'fixture.examples.pairingCreatedEnvelope',
        parsePairingCreated,
      ),
      pairingExchangeEnvelope: parsePairingEnvelope(
        examples.pairingExchangeEnvelope,
        'fixture.examples.pairingExchangeEnvelope',
        parsePairingExchange,
      ),
      pairingStatusEnvelope: parsePairingEnvelope(
        examples.pairingStatusEnvelope,
        'fixture.examples.pairingStatusEnvelope',
        parsePairingStatus,
      ),
      revision: parseRevision(examples.revision, 'fixture.examples.revision'),
      status: parseStatus(examples.status, 'fixture.examples.status'),
      successEnvelope: parseSuccessEnvelope(
        examples.successEnvelope,
        'fixture.examples.successEnvelope',
      ),
    },
  };
}

export function digestCaveContractFixture(value: string | Uint8Array): string {
  return createHash('sha256').update(toUtf8String(value)).digest('hex');
}

export function verifyCaveContractFixtureDigest(
  value: string | Uint8Array,
  expectedDigest: string,
): string {
  const normalizedExpectedDigest = normalizeDigest(expectedDigest);
  const actualDigest = digestCaveContractFixture(value);

  if (actualDigest !== normalizedExpectedDigest) {
    throw new TypeError(
      `Cave fixture digest mismatch: expected ${normalizedExpectedDigest}, received ${actualDigest}.`,
    );
  }

  return actualDigest;
}

export function parseCaveContractFixture(
  value: string | Uint8Array | JsonObject,
): CaveContractFixture {
  if (typeof value === 'string' || value instanceof Uint8Array) {
    return parseContractFixtureObject(JSON.parse(toUtf8String(value)) as unknown);
  }

  return parseContractFixtureObject(value);
}

export function parseVerifiedCaveContractFixture(
  value: string | Uint8Array,
  expectedDigest: string,
): CaveContractFixture {
  verifyCaveContractFixtureDigest(value, expectedDigest);
  return parseCaveContractFixture(value);
}
