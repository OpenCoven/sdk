import { createHash } from 'node:crypto';

export interface CaveContractFixture {
  contract: {
    apiVersion: string;
    capabilities: string[];
    errorCodes: string[];
    identityKinds: string[];
    limits: {
      cursorCharacters: number;
      defaultPageSize: number;
      errorDetailEntries: number;
      errorDetailValueCharacters: number;
      errorMessageCharacters: number;
      idempotencyKeyCharacters: number;
      maxPageSize: number;
      requestIdCharacters: number;
      revisionTokenCharacters: number;
    };
    minimumClientVersion: string;
    pairingScopes: string[];
  };
  examples: {
    cursor: {
      current: string;
      hasMore: boolean;
      next: string;
    };
    errorEnvelope: {
      apiVersion: string;
      capabilities: string[];
      error: {
        code: string;
        details: Record<string, string>;
        message: string;
        retryable: boolean;
      };
      minimumClientVersion: string;
      requestId: string;
    };
    identity: {
      displayName: string;
      id: string;
      kind: string;
    };
    revision: {
      token: string;
      updatedAt: string;
    };
    status: {
      status: 'ok';
    };
    successEnvelope: {
      apiVersion: string;
      capabilities: string[];
      cursor: {
        current: string;
        hasMore: boolean;
        next: string;
      };
      data: {
        status: 'ok';
      };
      identity: {
        displayName: string;
        id: string;
        kind: string;
      };
      minimumClientVersion: string;
      requestId: string;
      revision: {
        token: string;
        updatedAt: string;
      };
    };
  };
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null;
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

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number.`);
  }

  return value;
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
    Object.entries(record).map(([key, entry]) => [key, expectString(entry, `${path}.${key}`)]),
  );
}

function parseCursor(value: unknown, path: string) {
  const cursor = expectObject(value, path);

  return {
    current: expectString(cursor.current, `${path}.current`),
    hasMore: expectBoolean(cursor.hasMore, `${path}.hasMore`),
    next: expectString(cursor.next, `${path}.next`),
  };
}

function parseIdentity(value: unknown, path: string) {
  const identity = expectObject(value, path);

  return {
    displayName: expectString(identity.displayName, `${path}.displayName`),
    id: expectString(identity.id, `${path}.id`),
    kind: expectString(identity.kind, `${path}.kind`),
  };
}

function parseRevision(value: unknown, path: string) {
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

  return {
    status: parsedStatus,
  } as const;
}

function parseErrorEnvelope(value: unknown, path: string) {
  const envelope = expectObject(value, path);
  const error = expectObject(envelope.error, `${path}.error`);

  return {
    apiVersion: expectString(envelope.apiVersion, `${path}.apiVersion`),
    capabilities: expectStringArray(envelope.capabilities, `${path}.capabilities`),
    error: {
      code: expectString(error.code, `${path}.error.code`),
      details: expectStringRecord(error.details, `${path}.error.details`),
      message: expectString(error.message, `${path}.error.message`),
      retryable: expectBoolean(error.retryable, `${path}.error.retryable`),
    },
    minimumClientVersion: expectString(
      envelope.minimumClientVersion,
      `${path}.minimumClientVersion`,
    ),
    requestId: expectString(envelope.requestId, `${path}.requestId`),
  };
}

function parseSuccessEnvelope(value: unknown, path: string) {
  const envelope = expectObject(value, path);

  return {
    apiVersion: expectString(envelope.apiVersion, `${path}.apiVersion`),
    capabilities: expectStringArray(envelope.capabilities, `${path}.capabilities`),
    cursor: parseCursor(envelope.cursor, `${path}.cursor`),
    data: parseStatus(envelope.data, `${path}.data`),
    identity: parseIdentity(envelope.identity, `${path}.identity`),
    minimumClientVersion: expectString(
      envelope.minimumClientVersion,
      `${path}.minimumClientVersion`,
    ),
    requestId: expectString(envelope.requestId, `${path}.requestId`),
    revision: parseRevision(envelope.revision, `${path}.revision`),
  };
}

function parseContractFixtureObject(value: unknown): CaveContractFixture {
  const fixture = expectObject(value, 'fixture');
  const contract = expectObject(fixture.contract, 'fixture.contract');
  const limits = expectObject(contract.limits, 'fixture.contract.limits');
  const examples = expectObject(fixture.examples, 'fixture.examples');

  return {
    contract: {
      apiVersion: expectString(contract.apiVersion, 'fixture.contract.apiVersion'),
      capabilities: expectStringArray(contract.capabilities, 'fixture.contract.capabilities'),
      errorCodes: expectStringArray(contract.errorCodes, 'fixture.contract.errorCodes'),
      identityKinds: expectStringArray(contract.identityKinds, 'fixture.contract.identityKinds'),
      limits: {
        cursorCharacters: expectNumber(
          limits.cursorCharacters,
          'fixture.contract.limits.cursorCharacters',
        ),
        defaultPageSize: expectNumber(
          limits.defaultPageSize,
          'fixture.contract.limits.defaultPageSize',
        ),
        errorDetailEntries: expectNumber(
          limits.errorDetailEntries,
          'fixture.contract.limits.errorDetailEntries',
        ),
        errorDetailValueCharacters: expectNumber(
          limits.errorDetailValueCharacters,
          'fixture.contract.limits.errorDetailValueCharacters',
        ),
        errorMessageCharacters: expectNumber(
          limits.errorMessageCharacters,
          'fixture.contract.limits.errorMessageCharacters',
        ),
        idempotencyKeyCharacters: expectNumber(
          limits.idempotencyKeyCharacters,
          'fixture.contract.limits.idempotencyKeyCharacters',
        ),
        maxPageSize: expectNumber(limits.maxPageSize, 'fixture.contract.limits.maxPageSize'),
        requestIdCharacters: expectNumber(
          limits.requestIdCharacters,
          'fixture.contract.limits.requestIdCharacters',
        ),
        revisionTokenCharacters: expectNumber(
          limits.revisionTokenCharacters,
          'fixture.contract.limits.revisionTokenCharacters',
        ),
      },
      minimumClientVersion: expectString(
        contract.minimumClientVersion,
        'fixture.contract.minimumClientVersion',
      ),
      pairingScopes: expectStringArray(contract.pairingScopes, 'fixture.contract.pairingScopes'),
    },
    examples: {
      cursor: parseCursor(examples.cursor, 'fixture.examples.cursor'),
      errorEnvelope: parseErrorEnvelope(examples.errorEnvelope, 'fixture.examples.errorEnvelope'),
      identity: parseIdentity(examples.identity, 'fixture.examples.identity'),
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
