import { readFile, rm, writeFile } from 'node:fs/promises';

const pairingPath = 'packages/cave/src/pairing.ts';
const cavePackagePath = 'packages/cave/package.json';
const rootPackagePath = 'package.json';
const workflowPath = '.github/workflows/apply-cave-hpke-bound-v1.yml';
const scriptPath = 'scripts/apply-cave-hpke-bound-v1.mjs';

function replaceExactly(source, before, after, label) {
  const occurrences = source.split(before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`${label}: expected exactly one source match, received ${occurrences}.`);
  }
  return source.replace(before, after);
}

let pairing = await readFile(pairingPath, 'utf8');

pairing = replaceExactly(
  pairing,
  "import { caveAuthorityBindingFromDiscoveredEndpoint } from './authority-binding.js';\n",
  "import { caveAuthorityBindingFromDiscoveredEndpoint } from './authority-binding.js';\nimport {\n  createCaveHpkeBoundRequest,\n  type CaveHpkeAuthorization,\n  type CaveHpkeBoundRequest,\n} from './hpke-bound-v1.js';\n",
  'HPKE import',
);

pairing = replaceExactly(
  pairing,
  `function pairingAuthorityMismatchReason(
  expected: CaveDiscoveredEndpoint,
  current: CaveDiscoveredEndpoint,
): PairingAuthorityMismatchReason | undefined {
  if (
    current.endpoint.url !== expected.endpoint.url ||
    current.record.path !== expected.record.path
  ) {
    return 'authority_mismatch';
  }

  if (
    current.record.device !== expected.record.device ||
    current.record.inode !== expected.record.inode
  ) {
    return 'record_replaced';
  }

  if (
    current.freshness.pid !== expected.freshness.pid ||
    current.freshness.nonce !== expected.freshness.nonce ||
    current.freshness.startedAt !== expected.freshness.startedAt
  ) {
    return 'authority_restarted';
  }

  return undefined;
}`,
  `function pairingAuthorityMismatchReason(
  expected: CaveDiscoveredEndpoint,
  current: CaveDiscoveredEndpoint,
): PairingAuthorityMismatchReason | undefined {
  if (
    current.version !== expected.version ||
    current.endpoint.url !== expected.endpoint.url ||
    current.record.path !== expected.record.path
  ) {
    return 'authority_mismatch';
  }

  if (
    current.record.device !== expected.record.device ||
    current.record.inode !== expected.record.inode
  ) {
    return 'record_replaced';
  }

  if (
    current.freshness.pid !== expected.freshness.pid ||
    current.freshness.nonce !== expected.freshness.nonce ||
    current.freshness.startedAt !== expected.freshness.startedAt
  ) {
    return 'authority_restarted';
  }

  if (
    expected.version === 2 &&
    current.version === 2 &&
    (
      current.authority.mechanism !== expected.authority.mechanism ||
      current.authority.mode !== expected.authority.mode ||
      current.authority.keyId !== expected.authority.keyId ||
      current.authority.publicKey !== expected.authority.publicKey ||
      current.authority.suite.kemId !== expected.authority.suite.kemId ||
      current.authority.suite.kdfId !== expected.authority.suite.kdfId ||
      current.authority.suite.aeadId !== expected.authority.suite.aeadId
    )
  ) {
    return 'authority_restarted';
  }

  return undefined;
}`,
  'authority mismatch comparison',
);

pairing = replaceExactly(
  pairing,
  `  options: {
    body?: string;
    context?: OperationContext;
    credentials?: CaveCredentialBinding;`,
  `  options: {
    authorityAuthorization?: CaveHpkeAuthorization;
    authorityInstanceId?: string;
    body?: string;
    context?: OperationContext;
    credentials?: CaveCredentialBinding;`,
  'request options',
);

pairing = replaceExactly(
  pairing,
  `  const url = new URL(route, discovered.endpoint.url).toString();
  const headers = new Headers(options.headers);

  if (options.requireBearer === true) {
    const credentials = options.credentials;
    if (credentials === undefined) {
      throw transportError('unsupported_operation', 'A stored Cave credential was required.', {
        retryable: false,
      });
    }
    const credential = await loadBoundCredential(
      credentials.store,
      credentials.reference,
      discovered,
      (value) => BASE64URL_43_RE.test(value),
      {
        ...(options.context === undefined ? {} : { context: options.context }),
        invalidateInvalid: true,
        verifyAuthorityInstance: async (instanceId) => {
          const { payload } = await requestJson('GET', '/api/client/v1/health', {
            ...(options.context === undefined ? {} : { context: options.context }),
            discoverEndpoint: options.discoverEndpoint,
            discovery: options.discovery,
            fetchImplementation: options.fetchImplementation,
            maxResponseBytes: options.maxResponseBytes,
            pinnedAuthority: discovered,
          });
          return parseHealthResponse(payload).data.instanceId === instanceId;
        },
      },
    );
    ensureActive(options.context);

    if (credential.status === 'missing' || credential.status === 'invalid_bearer') {
      throw transportError('unauthorized', 'A stored Cave credential was not available.', {
        retryable: false,
        statusCode: 401,
      });
    }

    if (credential.status === 'invalid') {
      throw transportError(
        'reconcile_required',
        'The stored Cave credential must be paired again before reuse safely.',
        {
          details: {
            reason: credential.reason,
          },
          retryable: false,
        },
      );
    }

    headers.set('authorization', \`Bearer \${credential.bearer}\`);
  }
`,
  `  const url = new URL(route, discovered.endpoint.url).toString();
  const headers = new Headers(options.headers);
  let authorityAuthorization = options.authorityAuthorization;
  let authorityInstanceId = options.authorityInstanceId;

  if (options.requireBearer === true) {
    const credentials = options.credentials;
    if (credentials === undefined) {
      throw transportError('unsupported_operation', 'A stored Cave credential was required.', {
        retryable: false,
      });
    }
    const credential = await loadBoundCredential(
      credentials.store,
      credentials.reference,
      discovered,
      (value) => BASE64URL_43_RE.test(value),
      {
        ...(options.context === undefined ? {} : { context: options.context }),
        invalidateInvalid: true,
        verifyAuthorityInstance: async (instanceId) => {
          const { payload } = await requestJson('GET', '/api/client/v1/health', {
            ...(options.context === undefined ? {} : { context: options.context }),
            discoverEndpoint: options.discoverEndpoint,
            discovery: options.discovery,
            fetchImplementation: options.fetchImplementation,
            maxResponseBytes: options.maxResponseBytes,
            pinnedAuthority: discovered,
          });
          const verified = parseHealthResponse(payload).data.instanceId === instanceId;
          if (verified) {
            authorityInstanceId = instanceId;
          }
          return verified;
        },
      },
    );
    ensureActive(options.context);

    if (credential.status === 'missing' || credential.status === 'invalid_bearer') {
      throw transportError('unauthorized', 'A stored Cave credential was not available.', {
        retryable: false,
        statusCode: 401,
      });
    }

    if (credential.status === 'invalid') {
      throw transportError(
        'reconcile_required',
        'The stored Cave credential must be paired again before reuse safely.',
        {
          details: {
            reason: credential.reason,
          },
          retryable: false,
        },
      );
    }

    authorityAuthorization = {
      kind: 'bearer',
      value: credential.bearer,
    };
  }

  let hpkeRequest: CaveHpkeBoundRequest | undefined;
  try {
    if (authorityAuthorization !== undefined) {
      if (discovered.version === 2) {
        if (authorityInstanceId === undefined) {
          const { payload } = await requestJson('GET', '/api/client/v1/health', {
            ...(options.context === undefined ? {} : { context: options.context }),
            discoverEndpoint: options.discoverEndpoint,
            discovery: options.discovery,
            fetchImplementation: options.fetchImplementation,
            maxResponseBytes: options.maxResponseBytes,
            pinnedAuthority: discovered,
          });
          authorityInstanceId = parseHealthResponse(payload).data.instanceId;
        }
        hpkeRequest = await createCaveHpkeBoundRequest({
          discovered,
          instanceId: authorityInstanceId,
          url,
          method,
          ...(options.body === undefined
            ? {}
            : { body: new TextEncoder().encode(options.body) }),
          authorization: authorityAuthorization,
        });
        for (const [name, value] of hpkeRequest.headers) {
          headers.set(name, value);
        }
      } else if (authorityAuthorization.kind === 'pairing-secret') {
        headers.set('x-coven-pairing-secret', authorityAuthorization.value);
      } else {
        headers.set('authorization', \`Bearer \${authorityAuthorization.value}\`);
      }
    }
  } catch (error) {
    if (options.onPreDispatchFailure !== undefined) {
      throw options.onPreDispatchFailure(error);
    }
    throw error;
  }
`,
  'credential and HPKE request preparation',
);

pairing = replaceExactly(
  pairing,
  `  const text = await readResponseText(response, options.context, options.maxResponseBytes);
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw transportError('invalid_response', 'Cave response was not valid JSON.', {
      statusCode: response.status,
    });
  }

  if (response.status < 200 || response.status >= 300) {
    throw parseErrorPayload(
      response.status,
      payload,
      options.canonicalRequirements,
    );
  }

  return {
    discovered,
    payload,
  };`,
  `  let responseStatus = response.status;
  let responseBody: string;
  if (hpkeRequest === undefined) {
    responseBody = await readResponseText(
      response,
      options.context,
      options.maxResponseBytes,
    );
  } else {
    const opened = await hpkeRequest.open(response, {
      maxBodyBytes: options.maxResponseBytes,
      ...(options.context?.signal === undefined
        ? {}
        : { signal: options.context.signal }),
    });
    responseStatus = opened.status;
    try {
      responseBody = new TextDecoder('utf-8', { fatal: true }).decode(opened.body);
    } catch (cause) {
      throw transportError(
        'invalid_response',
        'The authenticated Cave response body was not valid UTF-8.',
        { cause, statusCode: responseStatus },
      );
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse(responseBody) as unknown;
  } catch {
    throw transportError('invalid_response', 'Cave response was not valid JSON.', {
      statusCode: responseStatus,
    });
  }

  if (responseStatus < 200 || responseStatus >= 300) {
    throw parseErrorPayload(
      responseStatus,
      payload,
      options.canonicalRequirements,
    );
  }

  return {
    discovered,
    payload,
  };`,
  'authenticated response handling',
);

pairing = replaceExactly(
  pairing,
  `          headers: {
            'x-coven-pairing-secret': pairingSecret,
          },
          maxResponseBytes: options.maxResponseBytes,
          pairingSecretDispatch: 'reusable',`,
  `          authorityAuthorization: {
            kind: 'pairing-secret',
            value: pairingSecret,
          },
          maxResponseBytes: options.maxResponseBytes,
          pairingSecretDispatch: 'reusable',`,
  'pairing poll authorization',
);

pairing = replaceExactly(
  pairing,
  `          headers: {
            'x-coven-pairing-secret': pairingSecret,
          },
          maxResponseBytes: options.maxResponseBytes,
          onPreDispatchFailure: (error) =>`,
  `          authorityAuthorization: {
            kind: 'pairing-secret',
            value: pairingSecret,
          },
          authorityInstanceId: expectedInstanceId,
          maxResponseBytes: options.maxResponseBytes,
          onPreDispatchFailure: (error) =>`,
  'pairing exchange authorization',
);

await writeFile(pairingPath, pairing, 'utf8');

const cavePackage = JSON.parse(await readFile(cavePackagePath, 'utf8'));
cavePackage.dependencies = Object.fromEntries(
  Object.entries({
    ...cavePackage.dependencies,
    '@hpke/core': '1.9.0',
    '@hpke/dhkem-x25519': '1.8.0',
    canonicalize: '3.0.0',
  }).sort(([left], [right]) => left.localeCompare(right)),
);
await writeFile(cavePackagePath, `${JSON.stringify(cavePackage, null, 2)}\n`, 'utf8');

const rootPackage = JSON.parse(await readFile(rootPackagePath, 'utf8'));
rootPackage.pnpm = {
  ...(rootPackage.pnpm ?? {}),
  overrides: {
    ...(rootPackage.pnpm?.overrides ?? {}),
    '@hpke/common': '1.10.0',
  },
};
rootPackage.pnpm.overrides = Object.fromEntries(
  Object.entries(rootPackage.pnpm.overrides).sort(([left], [right]) =>
    left.localeCompare(right),
  ),
);
await writeFile(rootPackagePath, `${JSON.stringify(rootPackage, null, 2)}\n`, 'utf8');

await rm(workflowPath, { force: true });
await rm(scriptPath, { force: true });
