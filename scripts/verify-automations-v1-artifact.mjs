import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { crc32, inflateRawSync } from 'node:zlib';

import {
  cleanupOwnedTempRoot,
  createOwnedTempDirectory,
} from './owned-temp-directory.mjs';

const require = createRequire(import.meta.url);
const contractDirectory = 'coven-automations-v1';
const sha256Pattern = /^[0-9a-f]{64}$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const expectedContractFiles = [
  'README.md',
  'automation-attempt.schema.json',
  'automation-definition.schema.json',
  'automation-occurrence.schema.json',
  'automation-receipt.schema.json',
  'automation-run.schema.json',
  'capabilities.json',
  'command-envelope.schema.json',
  'common.schema.json',
  'compatibility-matrix.json',
  'conformance-manifest.json',
  'coven.automations.v1.d.ts',
  'error-envelope.schema.json',
  'event-envelope.schema.json',
  'protocol-version.json',
  'state-machines.json',
  'test-vectors.json',
];
const schemaFiles = expectedContractFiles.filter((path) => path.endsWith('.schema.json'));
const usage =
  'usage: verify-automations-v1-artifact.mjs --archive <path> --bundle-sha256 <sha256> --source-commit <commit> --content-sha256 <sha256>';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fail(message) {
  throw new Error(message);
}

function assertObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`Malformed Automations v1 contract set: ${label} must be an object.`);
  }

  return value;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    fail(
      `Malformed Automations v1 contract set: ${label} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertExactStrings(actual, expected, label) {
  if (
    !Array.isArray(actual) ||
    actual.some((value) => typeof value !== 'string') ||
    actual.length !== expected.length ||
    [...actual].sort().some((value, index) => value !== [...expected].sort()[index])
  ) {
    fail(`Malformed Automations v1 contract set: ${label} does not match the v1 contract.`);
  }
}

function readNullTerminatedAscii(block, offset, length, label) {
  const field = block.subarray(offset, offset + length);
  const end = field.indexOf(0);
  const bytes = field.subarray(0, end === -1 ? field.length : end);

  if (bytes.some((byte) => byte > 0x7f)) {
    fail(`Invalid tar artifact: ${label} must be ASCII.`);
  }

  return bytes.toString('ascii');
}

function readTarNumber(block, offset, length, label) {
  const raw = block
    .subarray(offset, offset + length)
    .toString('ascii')
    .replace(/\0.*$/u, '')
    .trim();

  if (!/^[0-7]+$/u.test(raw)) {
    fail(`Invalid tar artifact: ${label} is not a valid octal value.`);
  }

  return Number.parseInt(raw, 8);
}

function assertSafeArchivePath(path) {
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    fail(`Unsafe archive path: ${path}`);
  }
}

function parseGzip(archive) {
  if (
    archive.length < 18 ||
    archive[0] !== 0x1f ||
    archive[1] !== 0x8b ||
    archive[2] !== 8
  ) {
    fail('Invalid gzip artifact: missing the gzip/deflate header.');
  }

  const flags = archive[3];
  if (flags === undefined || (flags & 0xe0) !== 0) {
    fail('Invalid gzip artifact: reserved gzip flags are set.');
  }

  let offset = 10;
  const requireBytes = (count, label) => {
    if (offset + count > archive.length - 8) {
      fail(`Invalid gzip artifact: truncated ${label}.`);
    }
  };
  const skipNullTerminated = (label) => {
    const end = archive.indexOf(0, offset);
    if (end === -1 || end > archive.length - 8) {
      fail(`Invalid gzip artifact: unterminated ${label}.`);
    }
    offset = end + 1;
  };

  if ((flags & 0x04) !== 0) {
    requireBytes(2, 'extra field length');
    const extraLength = archive.readUInt16LE(offset);
    offset += 2;
    requireBytes(extraLength, 'extra field');
    offset += extraLength;
  }
  if ((flags & 0x08) !== 0) {
    skipNullTerminated('file name');
  }
  if ((flags & 0x10) !== 0) {
    skipNullTerminated('comment');
  }
  if ((flags & 0x02) !== 0) {
    requireBytes(2, 'header CRC');
    const expectedHeaderCrc = archive.readUInt16LE(offset);
    const actualHeaderCrc = crc32(archive.subarray(0, offset)) & 0xffff;
    if (actualHeaderCrc !== expectedHeaderCrc) {
      fail('Invalid gzip artifact: header CRC mismatch.');
    }
    offset += 2;
  }

  let inflated;
  try {
    inflated = inflateRawSync(archive.subarray(offset), { info: true });
  } catch (error) {
    fail(
      `Invalid gzip artifact: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const compressedSize = inflated.engine.bytesWritten;
  const trailerOffset = offset + compressedSize;
  if (trailerOffset + 8 !== archive.length) {
    fail('Invalid gzip artifact: trailing bytes or concatenated members are not allowed.');
  }

  const expectedCrc = archive.readUInt32LE(trailerOffset);
  const expectedSize = archive.readUInt32LE(trailerOffset + 4);
  const actualCrc = crc32(inflated.buffer) >>> 0;

  if (actualCrc !== expectedCrc) {
    fail('Invalid gzip artifact: payload CRC mismatch.');
  }
  if (inflated.buffer.length % 0x1_0000_0000 !== expectedSize) {
    fail('Invalid gzip artifact: uncompressed size mismatch.');
  }

  return inflated.buffer;
}

function parseTar(bytes) {
  if (bytes.length < 1024 || bytes.length % 512 !== 0) {
    fail('Invalid tar artifact: archive length is not a complete tar stream.');
  }

  const entries = new Map();
  let offset = 0;
  let zeroBlocks = 0;

  while (offset < bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    offset += 512;

    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      continue;
    }

    if (zeroBlocks > 0) {
      fail('Invalid tar artifact: non-zero data follows an end marker.');
    }

    const storedChecksum = readTarNumber(header, 148, 8, 'header checksum');
    let actualChecksum = 0;
    for (let index = 0; index < header.length; index += 1) {
      actualChecksum += index >= 148 && index < 156 ? 0x20 : header[index];
    }
    if (storedChecksum !== actualChecksum) {
      fail('Invalid tar artifact: header checksum mismatch.');
    }

    const magic = header.subarray(257, 263).toString('ascii');
    const version = header.subarray(263, 265).toString('ascii');
    if (magic !== 'ustar\0' || version !== '00') {
      fail('Invalid tar artifact: only POSIX ustar entries are accepted.');
    }

    const type = header[156];
    if (type !== 0 && type !== 0x30) {
      fail('Invalid tar artifact: only regular files are accepted.');
    }

    const name = readNullTerminatedAscii(header, 0, 100, 'entry name');
    const prefix = readNullTerminatedAscii(header, 345, 155, 'entry prefix');
    const path = prefix.length > 0 ? `${prefix}/${name}` : name;
    assertSafeArchivePath(path);

    if (entries.has(path)) {
      fail(`Duplicate archive path: ${path}`);
    }

    const size = readTarNumber(header, 124, 12, `size for ${path}`);
    const paddedSize = Math.ceil(size / 512) * 512;
    if (offset + paddedSize > bytes.length) {
      fail(`Invalid tar artifact: truncated file data for ${path}.`);
    }

    entries.set(path, Buffer.from(bytes.subarray(offset, offset + size)));
    offset += paddedSize;
  }

  if (zeroBlocks < 2) {
    fail('Invalid tar artifact: missing the two-block end marker.');
  }

  return entries;
}

function parseManifest(entries) {
  const bytes = entries.get('manifest.json');
  if (bytes === undefined) {
    fail('Missing archive path: manifest.json');
  }

  const manifest = assertObject(parseJson(bytes, 'manifest.json'), 'manifest.json');
  if (
    manifest.schemaVersion !== 'coven.automations.bundle.v1' ||
    manifest.contractProfile !== 'coven.automations.v1' ||
    typeof manifest.sourceCommit !== 'string' ||
    !commitPattern.test(manifest.sourceCommit) ||
    typeof manifest.contractContentSha256 !== 'string' ||
    !sha256Pattern.test(manifest.contractContentSha256) ||
    !Array.isArray(manifest.files)
  ) {
    fail('Malformed Automations v1 contract set: manifest.json has invalid identity fields.');
  }

  const files = [];
  const paths = new Set();
  for (const value of manifest.files) {
    const file = assertObject(value, 'manifest.json files entry');
    if (
      typeof file.path !== 'string' ||
      typeof file.sha256 !== 'string' ||
      !sha256Pattern.test(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0
    ) {
      fail('Malformed Automations v1 contract set: manifest.json has an invalid file entry.');
    }
    assertSafeArchivePath(file.path);
    if (file.path.includes('/') || paths.has(file.path)) {
      fail(`Malformed Automations v1 contract set: duplicate or nested manifest path ${file.path}.`);
    }
    paths.add(file.path);
    files.push(file);
  }

  assertExactStrings([...paths], expectedContractFiles, 'manifest file list');
  return { ...manifest, files };
}

function verifyManifestFiles(entries, manifest) {
  const expectedArchivePaths = new Set([
    'manifest.json',
    ...expectedContractFiles.map((path) => `${contractDirectory}/${path}`),
  ]);

  for (const path of entries.keys()) {
    if (!expectedArchivePaths.has(path)) {
      fail(`Unexpected archive path: ${path}`);
    }
  }
  for (const path of expectedArchivePaths) {
    if (!entries.has(path)) {
      fail(`Missing archive path: ${path}`);
    }
  }

  for (const file of manifest.files) {
    const archivePath = `${contractDirectory}/${file.path}`;
    const bytes = entries.get(archivePath);
    if (bytes === undefined) {
      fail(`Missing archive path: ${archivePath}`);
    }
    if (bytes.length !== file.size) {
      fail(
        `Manifest size mismatch for ${file.path}: expected ${file.size}, received ${bytes.length}.`,
      );
    }
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== file.sha256) {
      fail(
        `Manifest SHA-256 mismatch for ${file.path}: expected ${file.sha256}, received ${actualSha256}.`,
      );
    }
  }

  const digestInput = [...manifest.files]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map(({ path, sha256: digest }) => `${path}\0${digest}\n`)
    .join('');
  const actualContentSha256 = sha256(digestInput);

  if (actualContentSha256 !== manifest.contractContentSha256) {
    fail(
      `Contract content SHA-256 mismatch: manifest records ${manifest.contractContentSha256}, computed ${actualContentSha256}.`,
    );
  }

  return actualContentSha256;
}

function readContractJson(entries, path) {
  const bytes = entries.get(`${contractDirectory}/${path}`);
  if (bytes === undefined) {
    fail(`Missing archive path: ${contractDirectory}/${path}`);
  }
  return assertObject(parseJson(bytes, path), path);
}

function validateContractSet(entries) {
  for (const path of schemaFiles) {
    const schema = readContractJson(entries, path);
    let validRoot;
    if (path === 'common.schema.json') {
      assertObject(schema.$defs, `${path} $defs`);
      validRoot = true;
    } else if (path === 'command-envelope.schema.json') {
      validRoot = Array.isArray(schema.oneOf);
    } else if (path === 'error-envelope.schema.json') {
      validRoot = typeof schema.$ref === 'string';
    } else {
      validRoot = schema.type === 'object';
    }

    if (
      schema.$schema !== 'https://json-schema.org/draft/2020-12/schema' ||
      schema.$id !== `https://opencoven.ai/spec/coven-automations/v1/${path}` ||
      !validRoot
    ) {
      fail(`Malformed Automations v1 contract set: ${path} has an invalid v1 schema root.`);
    }
  }

  for (const path of [
    'protocol-version.json',
    'capabilities.json',
    'compatibility-matrix.json',
    'state-machines.json',
  ]) {
    const metadata = readContractJson(entries, path);
    if (metadata.contractProfile !== 'coven.automations.v1' || metadata.version !== 1) {
      fail(`Malformed Automations v1 contract set: ${path} has the wrong profile or version.`);
    }
  }

  const conformance = readContractJson(entries, 'conformance-manifest.json');
  if (
    conformance.protocol !== 'Coven Automations' ||
    conformance.contractProfile !== 'coven.automations.v1' ||
    conformance.stateMachines !== 'state-machines.json' ||
    conformance.compatibilityMatrix !== 'compatibility-matrix.json' ||
    conformance.goldenVectors !== 'test-vectors.json'
  ) {
    fail('Malformed Automations v1 contract set: conformance manifest references are invalid.');
  }
  assertExactStrings(conformance.schemas, schemaFiles, 'conformance schema list');
  assertExactStrings(
    conformance.objects,
    [
      'AutomationDefinition',
      'AutomationOccurrence',
      'AutomationRun',
      'AutomationAttempt',
      'AutomationReceipt',
      'CommandEnvelope',
      'CommandResponse',
      'ErrorEnvelope',
      'EventEnvelope',
    ],
    'conformance object list',
  );
  const requiredSuites = conformance.requiredSuites;
  if (
    !Array.isArray(requiredSuites) ||
    ![
      'duplicate-and-out-of-order-event-replay',
      'golden-vectors-external-runners',
      'packed-artifact-canaries',
    ].every((suite) => requiredSuites.includes(suite))
  ) {
    fail('Malformed Automations v1 contract set: required conformance suites are missing.');
  }
  const canaryRequirements = assertObject(
    conformance.canaryRequirements,
    'conformance-manifest.json canaryRequirements',
  );
  if (typeof canaryRequirements.sdk !== 'string' || canaryRequirements.sdk.length === 0) {
    fail('Malformed Automations v1 contract set: SDK canary requirement is missing.');
  }

  const declaration = entries
    .get(`${contractDirectory}/coven.automations.v1.d.ts`)
    ?.toString('utf8');
  if (
    declaration === undefined ||
    !/export interface AutomationDefinition\b/u.test(declaration) ||
    !/export interface CommandEnvelope\b/u.test(declaration) ||
    !/export type EventEnvelope\b|export interface EventEnvelope\b/u.test(declaration)
  ) {
    fail('Malformed Automations v1 contract set: pinned TypeScript declarations are incomplete.');
  }

  const vectors = readContractJson(entries, 'test-vectors.json');
  if (
    vectors.contractProfile !== 'coven.automations.v1' ||
    vectors.version !== 1 ||
    !Array.isArray(vectors.cases)
  ) {
    fail('Malformed Automations v1 contract set: golden vector identity is invalid.');
  }
  const fixtures = assertObject(vectors.fixtures, 'test-vectors.json fixtures');
  if (!Array.isArray(fixtures['event.occurrence.sequence'])) {
    fail('Malformed Automations v1 contract set: occurrence event sequence fixture is missing.');
  }

  return vectors;
}

function assertEvent(value, stream) {
  const event = assertObject(value, 'changefeed event');
  const eventStream = assertObject(event.stream, 'changefeed event stream');
  const payload = assertObject(event.payload, 'changefeed event payload');

  if (
    event.schemaVersion !== 'coven.automations.v1' ||
    typeof event.eventId !== 'string' ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence < 0 ||
    event.kind !== 'occurrence.transitioned' ||
    eventStream.kind !== stream.kind ||
    eventStream.id !== stream.id ||
    payload.entity !== 'occurrence' ||
    typeof payload.from !== 'string' ||
    typeof payload.to !== 'string'
  ) {
    fail('Malformed Automations v1 contract set: changefeed event shape is invalid.');
  }

  return event;
}

function initialProjection() {
  return {
    cursor: -1,
    state: 'none',
    firstSequence: undefined,
    lastSequence: undefined,
    appliedEventIds: new Set(),
  };
}

function applyDelivery(projection, value, stream) {
  const event = assertEvent(value, stream);

  if (projection.appliedEventIds.has(event.eventId)) {
    return projection;
  }
  if (event.sequence !== projection.cursor + 1) {
    const error = new Error(
      `STREAM_OUT_OF_ORDER: received sequence ${event.sequence} after cursor ${projection.cursor}.`,
    );
    error.code = 'STREAM_OUT_OF_ORDER';
    throw error;
  }

  const payload = event.payload;
  if (payload.from !== projection.state) {
    fail(
      `Malformed Automations v1 contract set: event ${event.eventId} regresses from ${payload.from} while the SDK projection is ${projection.state}.`,
    );
  }

  projection.cursor = event.sequence;
  projection.state = payload.to;
  projection.firstSequence ??= event.sequence;
  projection.lastSequence = event.sequence;
  projection.appliedEventIds.add(event.eventId);
  return projection;
}

function foldDeliveries(deliveries, stream, seed = initialProjection()) {
  for (const event of deliveries) {
    applyDelivery(seed, event, stream);
  }
  return seed;
}

function projectionResult(projection) {
  return {
    cursor: projection.cursor,
    state: projection.state,
    firstSequence: projection.firstSequence,
    lastSequence: projection.lastSequence,
  };
}

function resolveEventReference(reference, sequence) {
  const match = /^event\.occurrence\.sequence\[(\d+)\]$/u.exec(reference);
  if (match === null) {
    fail(`Malformed Automations v1 contract set: unsupported event reference ${reference}.`);
  }
  const index = Number(match[1]);
  const event = sequence[index];
  if (event === undefined) {
    fail(`Malformed Automations v1 contract set: event reference ${reference} is out of range.`);
  }
  return event;
}

function resolveDeliveryDescription(description, sequence) {
  const match =
    /^event\.occurrence\.sequence\[(\d+)\.\.(\d+)\](?: plus a duplicate of \[(\d+)\])?$/u.exec(
      description,
    );
  if (match === null) {
    fail(`Malformed Automations v1 contract set: unsupported delivery description ${description}.`);
  }

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start > end) {
    fail(`Malformed Automations v1 contract set: reversed delivery range ${description}.`);
  }
  const deliveries = [];
  for (let index = start; index <= end; index += 1) {
    const event = sequence[index];
    if (event === undefined) {
      fail(`Malformed Automations v1 contract set: delivery range ${description} is out of range.`);
    }
    deliveries.push(event);
  }
  if (match[3] !== undefined) {
    const duplicate = sequence[Number(match[3])];
    if (duplicate === undefined) {
      fail(`Malformed Automations v1 contract set: duplicate in ${description} is out of range.`);
    }
    deliveries.push(duplicate);
  }
  return deliveries;
}

function findCase(cases, name) {
  const match = cases.find((value) => {
    const candidate = assertObject(value, `golden vector case ${name}`);
    return candidate.name === name;
  });
  if (match === undefined) {
    fail(`Malformed Automations v1 contract set: missing golden vector case ${name}.`);
  }
  return assertObject(match, `golden vector case ${name}`);
}

function exerciseGoldenVectors(vectors) {
  const fixtures = assertObject(vectors.fixtures, 'test-vectors.json fixtures');
  const sequence = fixtures['event.occurrence.sequence'];
  const cases = vectors.cases;

  const duplicateCase = findCase(cases, 'event-duplicate-delivery-is-ignored');
  const duplicateStream = assertObject(duplicateCase.stream, 'duplicate delivery stream');
  if (!Array.isArray(duplicateCase.deliveries)) {
    fail('Malformed Automations v1 contract set: duplicate deliveries are missing.');
  }
  const duplicateDeliveries = duplicateCase.deliveries.map((reference) => {
    if (typeof reference !== 'string') {
      fail('Malformed Automations v1 contract set: duplicate delivery reference is not a string.');
    }
    return resolveEventReference(reference, sequence);
  });
  const duplicateIds = new Set();
  let redeliveredAppliedEvent = false;
  for (const eventValue of duplicateDeliveries) {
    const event = assertEvent(eventValue, duplicateStream);
    if (duplicateIds.has(event.eventId)) {
      redeliveredAppliedEvent = true;
    } else {
      duplicateIds.add(event.eventId);
    }
  }
  if (!redeliveredAppliedEvent) {
    fail(
      'Malformed Automations v1 contract set: duplicate-delivery case must redeliver an already-applied event.',
    );
  }
  const duplicateResult = projectionResult(
    foldDeliveries(duplicateDeliveries, duplicateStream),
  );
  const canonicalDuplicateResult = projectionResult(
    foldDeliveries(sequence.slice(0, 3), duplicateStream),
  );
  if (JSON.stringify(duplicateResult) !== JSON.stringify(canonicalDuplicateResult)) {
    fail('Duplicate delivery conformance failed.');
  }

  const outOfOrderCase = findCase(
    cases,
    'event-out-of-order-is-rejected-not-reordered',
  );
  const outOfOrderStream = assertObject(outOfOrderCase.stream, 'out-of-order stream');
  if (
    outOfOrderCase.expected !== 'reject' ||
    outOfOrderCase.errorCode !== 'STREAM_OUT_OF_ORDER' ||
    !Number.isSafeInteger(outOfOrderCase.consumerCursor) ||
    !Array.isArray(outOfOrderCase.deliveries)
  ) {
    fail('Malformed Automations v1 contract set: out-of-order case expectations are invalid.');
  }
  const checkpoint = foldDeliveries(
    sequence.slice(0, outOfOrderCase.consumerCursor + 1),
    outOfOrderStream,
  );
  checkpoint.appliedEventIds.clear();
  let refusedOutOfOrder = false;
  try {
    foldDeliveries(
      outOfOrderCase.deliveries.map((reference) =>
        resolveEventReference(reference, sequence),
      ),
      outOfOrderStream,
      checkpoint,
    );
  } catch (error) {
    if (error instanceof Error && error.code === outOfOrderCase.errorCode) {
      refusedOutOfOrder = true;
    } else {
      throw error;
    }
  }
  if (!refusedOutOfOrder) {
    fail('Out-of-order refusal conformance failed.');
  }

  const replayCase = findCase(cases, 'event-replay-rehydrates-deterministically');
  const replayStream = assertObject(replayCase.stream, 'replay stream');
  if (!Array.isArray(replayCase.reductions)) {
    fail('Malformed Automations v1 contract set: replay reductions are missing.');
  }
  const reductionsByLabel = new Map();
  for (const value of replayCase.reductions) {
    const reduction = assertObject(value, 'replay reduction');
    if (typeof reduction.label !== 'string' || reductionsByLabel.has(reduction.label)) {
      fail('Malformed Automations v1 contract set: replay reduction labels must be unique.');
    }
    reductionsByLabel.set(reduction.label, reduction);
  }
  const expectedReductionLabels = [
    'from-empty',
    'from-empty-with-duplicate',
    'resume-after-cursor-2',
  ];
  if (
    reductionsByLabel.size !== expectedReductionLabels.length ||
    expectedReductionLabels.some((label) => !reductionsByLabel.has(label))
  ) {
    fail(
      'Malformed Automations v1 contract set: replay case must include from-empty-with-duplicate and resume-after-cursor-2.',
    );
  }
  const fromEmpty = reductionsByLabel.get('from-empty');
  const fromEmptyWithDuplicate = reductionsByLabel.get(
    'from-empty-with-duplicate',
  );
  const resumeAfterCursor = reductionsByLabel.get('resume-after-cursor-2');
  if (
    fromEmpty.cursor !== -1 ||
    fromEmpty.deliveries !== 'event.occurrence.sequence[0..5]'
  ) {
    fail(
      'Malformed Automations v1 contract set: from-empty must fold deliveries 0 through 5 from cursor -1.',
    );
  }
  if (
    fromEmptyWithDuplicate.cursor !== -1 ||
    fromEmptyWithDuplicate.deliveries !==
      'event.occurrence.sequence[0..5] plus a duplicate of [3]'
  ) {
    fail(
      'Malformed Automations v1 contract set: from-empty-with-duplicate must redeliver event 3 after the full sequence.',
    );
  }
  if (
    resumeAfterCursor.cursor !== 2 ||
    resumeAfterCursor.deliveries !== 'event.occurrence.sequence[3..5]'
  ) {
    fail(
      'Malformed Automations v1 contract set: resume-after-cursor-2 must resume at cursor 2 with deliveries 3 through 5.',
    );
  }
  const canonical = projectionResult(foldDeliveries(sequence, replayStream));
  const reductions = expectedReductionLabels.map((label) => {
    const value = reductionsByLabel.get(label);
    const reduction = assertObject(value, 'replay reduction');
    if (
      !Number.isSafeInteger(reduction.cursor) ||
      reduction.cursor < -1 ||
      typeof reduction.deliveries !== 'string'
    ) {
      fail('Malformed Automations v1 contract set: replay reduction is invalid.');
    }
    const seed = foldDeliveries(sequence.slice(0, reduction.cursor + 1), replayStream);
    return projectionResult(
      foldDeliveries(
        resolveDeliveryDescription(reduction.deliveries, sequence),
        replayStream,
        seed,
      ),
    );
  });
  if (
    reductions.some((result) => JSON.stringify(result) !== JSON.stringify(canonical)) ||
    canonical.state !== 'succeeded' ||
    canonical.lastSequence !== sequence.length - 1
  ) {
    fail('Reconnect/replay convergence conformance failed.');
  }
}

function typecheckPinnedDeclaration(entries) {
  const temp = createOwnedTempDirectory({
    prefix: 'opencoven-automations-v1-canary',
    childSegments: ['artifact'],
  });

  try {
    for (const [archivePath, bytes] of entries) {
      const destination = resolve(temp.path, archivePath);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, bytes, { mode: 0o600 });
    }

    const fixturePath = resolve(temp.path, 'artifact-consumer.ts');
    const configPath = resolve(temp.path, 'tsconfig.json');
    writeFileSync(
      fixturePath,
      [
        `import type { AutomationDefinition, CommandEnvelope, EventEnvelope } from './${contractDirectory}/coven.automations.v1.d.ts';`,
        '',
        'declare const definition: AutomationDefinition;',
        'declare const command: CommandEnvelope;',
        'declare const event: EventEnvelope;',
        '',
        'const digest: string = definition.integrity.value;',
        'const commandName: string = command.command;',
        'const sequence: number = event.sequence;',
        "if (event.kind === 'occurrence.transitioned') {",
        '  const nextState: string = event.payload.to;',
        '  void nextState;',
        '}',
        'void [digest, commandName, sequence];',
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2024',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            allowImportingTsExtensions: true,
            types: [],
            lib: ['ES2024'],
          },
          files: ['./artifact-consumer.ts'],
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );

    const tscPath = require.resolve('typescript/bin/tsc');
    const result = spawnSync(
      process.execPath,
      [tscPath, '--pretty', 'false', '--project', configPath],
      {
        cwd: temp.path,
        encoding: 'utf8',
      },
    );
    if (result.status !== 0) {
      fail(
        `Pinned TypeScript declaration typecheck failed:\n${result.stdout}${result.stderr}`,
      );
    }
  } finally {
    cleanupOwnedTempRoot(temp);
  }
}

export function parseAutomationsArtifactArguments(argv) {
  if (argv[0] === '--') {
    argv = argv.slice(1);
  }
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !['--archive', '--bundle-sha256', '--source-commit', '--content-sha256'].includes(
        flag,
      ) ||
      typeof value !== 'string' ||
      values.has(flag)
    ) {
      fail(usage);
    }
    values.set(flag, value);
  }
  if (values.size !== 4) {
    fail(usage);
  }

  const bundleSha256 = values.get('--bundle-sha256');
  const sourceCommit = values.get('--source-commit');
  const contentSha256 = values.get('--content-sha256');
  if (
    !sha256Pattern.test(bundleSha256) ||
    !commitPattern.test(sourceCommit) ||
    !sha256Pattern.test(contentSha256)
  ) {
    fail(usage);
  }

  return {
    archivePath: resolve(values.get('--archive')),
    bundleSha256,
    sourceCommit,
    contentSha256,
  };
}

export function verifyAutomationsArtifact({
  archivePath,
  bundleSha256,
  sourceCommit,
  contentSha256,
}) {
  const archive = readFileSync(archivePath);
  const actualBundleSha256 = sha256(archive);
  if (actualBundleSha256 !== bundleSha256) {
    fail(
      `Bundle SHA-256 mismatch: expected ${bundleSha256}, received ${actualBundleSha256}.`,
    );
  }

  const entries = parseTar(parseGzip(archive));
  const manifest = parseManifest(entries);
  verifyManifestFiles(entries, manifest);

  if (manifest.sourceCommit !== sourceCommit) {
    fail(
      `Source commit mismatch: expected ${sourceCommit}, manifest records ${manifest.sourceCommit}.`,
    );
  }
  if (manifest.contractContentSha256 !== contentSha256) {
    fail(
      `Contract content SHA-256 mismatch: expected ${contentSha256}, manifest records ${manifest.contractContentSha256}.`,
    );
  }

  const vectors = validateContractSet(entries);
  typecheckPinnedDeclaration(entries);
  exerciseGoldenVectors(vectors);

  return {
    sourceCommit,
    bundleSha256,
    contractContentSha256: contentSha256,
    manifestFiles: manifest.files.length,
  };
}

function main() {
  const result = verifyAutomationsArtifact(
    parseAutomationsArtifactArguments(process.argv.slice(2)),
  );
  process.stdout.write(
    [
      'Automations v1 artifact verified:',
      `sourceCommit=${result.sourceCommit}`,
      `bundleSha256=${result.bundleSha256}`,
      `contractContentSha256=${result.contractContentSha256}`,
      `manifestFiles=${result.manifestFiles}`,
      'typecheck=passed',
      'duplicateDelivery=passed',
      'outOfOrderRefusal=passed',
      'reconnectReplay=passed',
    ].join(' ') + '\n',
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Automations v1 artifact canary failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  }
}
