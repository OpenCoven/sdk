import { OperationConfigurationError } from '@opencoven/sdk-core/browser';

import {
  parsePrivilegedConfirmation,
  validatePrivilegedOperationId,
} from './privileged-capabilities.js';

/**
 * Bounded attachment transfer for the privileged authority tier.
 *
 * This module owns the SDK half of the attachment contract: fail-closed
 * preflight validation (file count, per-file size, total request size,
 * declared MIME type versus signature, filename, traversal, symlink, and
 * ownership binding) and the metadata-only records that bind an attachment
 * to its uploader credential and conversation atomically. Attachment bytes
 * exist only inside the in-flight upload request; they never enter the
 * canonical attachment record, and therefore never enter canonical
 * conversation JSON, browser storage, profile config, or diagnostic bundles.
 * The SDK never hashes attachment bytes: the canonical byte digest is
 * Cave's, computed server-side where the bytes land, and appears in records
 * only as a validated string.
 *
 * Upstream-contract gap (stated, not invented): the authoritative Cave
 * fixture pinned at `4adc97b1` declares the `attachments:write` pairing
 * scope but no attachment operations and no attachment capability family,
 * so no transport binding or route path ships; upload and download report
 * `unsupported_operation` until the producer contract lands and
 * `pnpm sync:contracts` imports it. Cave revalidates every limit, the
 * content signature, and the ownership binding server-side.
 *
 * This module is import-pure: no discovery, credential, filesystem, network,
 * or daemon I/O happens at import time.
 */

export const CAVE_ATTACHMENT_LIMITS = Object.freeze({
  /** Maximum attachments in one upload request. */
  maxFiles: 10,
  /** Maximum byte size of one attachment. */
  maxFileBytes: 10 * 1024 * 1024,
  /** Maximum summed byte size of one upload request. */
  maxRequestBytes: 25 * 1024 * 1024,
  /** Maximum filename length in UTF-16 code units. */
  maxFilenameCharacters: 128,
  /** Maximum canonical identifier length for attachment/credential IDs. */
  maxReferenceCharacters: 64,
});

/**
 * The approved content-type allowlist. SVG, archive, and executable types
 * are forbidden by the issue's non-goals and are not present.
 */
export const CAVE_ATTACHMENT_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
] as const;

export type CaveAttachmentContentType =
  (typeof CAVE_ATTACHMENT_CONTENT_TYPES)[number];

const CONTENT_TYPE_SET: ReadonlySet<string> = new Set(
  CAVE_ATTACHMENT_CONTENT_TYPES,
);

function isCaveAttachmentContentType(
  value: string,
): value is CaveAttachmentContentType {
  return CONTENT_TYPE_SET.has(value);
}

/** Declared type → magic-byte signature prefixes (first bytes of the file). */
const ATTACHMENT_SIGNATURES: Readonly<
  Record<Exclude<CaveAttachmentContentType, 'text/plain'>, readonly number[]>
> = Object.freeze({
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/gif': [0x47, 0x49, 0x46, 0x38], // "GIF8" covers GIF87a and GIF89a
  'image/webp': [0x52, 0x49, 0x46, 0x46], // "RIFF" + "WEBP" at offset 8
  'application/pdf': [0x25, 0x50, 0x44, 0x46], // "%PDF"
});

/** Text detection inspects at most this many leading bytes. */
const TEXT_SNIFF_WINDOW = 512;

export class CaveAttachmentSchemaError extends TypeError {
  readonly field: string;

  constructor(field: string) {
    super(`${field} was malformed.`);
    this.name = 'CaveAttachmentSchemaError';
    this.field = field;
  }
}

function matchesSignature(
  content: Uint8Array,
  signature: readonly number[],
): boolean {
  if (content.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => content[index] === byte);
}

function isDeclaredText(content: Uint8Array): boolean {
  const window = content.subarray(0, Math.min(TEXT_SNIFF_WINDOW, content.length));
  for (const byte of window) {
    // NUL bytes mark binary content; all other validity is delegated to the
    // strict UTF-8 decode below, which also covers malformed sequences.
    if (byte === 0x00) {
      return false;
    }
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(window);
  } catch {
    return false;
  }
  return true;
}

/**
 * Signature-sniff the declared content type from the leading bytes. Returns
 * the matched allowlisted type, `'text/plain'` when the bytes decode as
 * UTF-8 text without binary markers, or `undefined` when nothing matches.
 * A declared binary type whose bytes do not carry its signature is never
 * accepted.
 */
export function sniffCaveAttachmentContentType(
  content: Uint8Array,
): CaveAttachmentContentType | undefined {
  for (const [contentType, signature] of Object.entries(ATTACHMENT_SIGNATURES)) {
    if (matchesSignature(content, signature)) {
      if (contentType === 'image/webp') {
        // "RIFF" alone is not WebP: the container magic "WEBP" must follow
        // at offset 8.
        if (
          content.length < 12 ||
          content[8] !== 0x57 ||
          content[9] !== 0x45 ||
          content[10] !== 0x42 ||
          content[11] !== 0x50
        ) {
          return undefined;
        }
      }
      return contentType as CaveAttachmentContentType;
    }
  }
  if (isDeclaredText(content)) {
    return 'text/plain';
  }
  return undefined;
}

function validateFilename(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new OperationConfigurationError(
      'attachment filename must be a non-empty string',
    );
  }
  if (value.length > CAVE_ATTACHMENT_LIMITS.maxFilenameCharacters) {
    throw new OperationConfigurationError(
      `attachment filename must be at most ${CAVE_ATTACHMENT_LIMITS.maxFilenameCharacters} characters`,
    );
  }
  if (value !== value.trim() || value.endsWith('.') || value.endsWith(' ')) {
    throw new OperationConfigurationError(
      'attachment filename must not end with a dot or whitespace',
    );
  }
  if (value === '.' || value === '..') {
    throw new OperationConfigurationError(
      'attachment filename must not be a dot path segment',
    );
  }
  if (value.startsWith('.')) {
    // Hidden dotfiles are refused fail closed.
    throw new OperationConfigurationError(
      'attachment filename must not start with a dot',
    );
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      throw new OperationConfigurationError(
        'attachment filename must not contain control characters',
      );
    }
  }
  if (
    value.includes('/') ||
    value.includes('\\') ||
    value.includes(':') ||
    value.includes('*') ||
    value.includes('?') ||
    value.includes('"') ||
    value.includes('<') ||
    value.includes('>') ||
    value.includes('|')
  ) {
    throw new OperationConfigurationError(
      'attachment filename must not contain path, separator, or reserved characters',
    );
  }
  return value;
}

function validateReferenceId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new OperationConfigurationError(`${label} must be a non-empty string`);
  }
  if (value === '.' || value === '..') {
    throw new OperationConfigurationError(`${label} must not be a dot path segment`);
  }
  if (value.length > CAVE_ATTACHMENT_LIMITS.maxReferenceCharacters) {
    throw new OperationConfigurationError(
      `${label} must be at most ${CAVE_ATTACHMENT_LIMITS.maxReferenceCharacters} characters`,
    );
  }
  return value;
}

function validateDigest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new CaveAttachmentSchemaError(`${field}`);
  }
  return value;
}

export interface CaveAttachmentContent {
  readonly filename: string;
  readonly contentType: CaveAttachmentContentType;
  readonly content: Uint8Array;
  readonly symlink?: false;
}

export interface CaveAttachmentDescriptor {
  readonly filename: string;
  readonly contentType: CaveAttachmentContentType;
  readonly sizeBytes: number;
}

export interface CaveAttachmentBinding {
  readonly conversationId: string;
  readonly uploaderCredentialId: string;
  readonly attachments: readonly CaveAttachmentDescriptor[];
  readonly totalBytes: number;
}

export interface CaveAttachmentUploadRequest {
  readonly operationId: string;
  readonly confirmed: true;
  readonly conversationId: string;
  readonly uploaderCredentialId: string;
  readonly attachments: readonly CaveAttachmentContent[];
}

export interface CaveAttachmentDownloadRequest {
  readonly operationId: string;
  readonly confirmed: true;
  readonly conversationId: string;
  readonly attachmentId: string;
  /** Optional ceiling; the parser defaults it to `maxFileBytes`. */
  readonly maxBytes?: number;
}

/**
 * The canonical attachment record: metadata bound to its conversation and
 * uploader credential. There is no byte field on this type by construction —
 * attachment bytes never enter canonical conversation JSON.
 */
export interface CaveAttachmentRecord {
  readonly attachmentId: string;
  readonly conversationId: string;
  readonly uploaderCredentialId: string;
  readonly filename: string;
  readonly contentType: CaveAttachmentContentType;
  readonly sizeBytes: number;
  readonly digestSha256: string;
}

function validateAttachmentInput(input: unknown): CaveAttachmentContent {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new OperationConfigurationError(
      'attachment must be an object',
    );
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set(['filename', 'contentType', 'content', 'symlink']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new OperationConfigurationError('attachment has an unknown field');
    }
  }
  if (record.symlink !== undefined && record.symlink !== false) {
    // Fail closed: symlinked sources are never uploaded; the caller resolves
    // the target explicitly and uploads the resolved regular file.
    throw new OperationConfigurationError(
      'attachment must not be a symlink',
    );
  }

  const filename = validateFilename(record.filename);
  const contentType = record.contentType;
  if (
    typeof contentType !== 'string' ||
    !isCaveAttachmentContentType(contentType)
  ) {
    throw new OperationConfigurationError(
      'attachment contentType is not on the approved allowlist',
    );
  }
  const content = record.content;
  if (!(content instanceof Uint8Array) || content.length === 0) {
    throw new OperationConfigurationError(
      'attachment content must be a non-empty byte array',
    );
  }
  if (content.length > CAVE_ATTACHMENT_LIMITS.maxFileBytes) {
    throw new OperationConfigurationError(
      `attachment content must be at most ${CAVE_ATTACHMENT_LIMITS.maxFileBytes} bytes`,
    );
  }
  const sniffed = sniffCaveAttachmentContentType(content);
  if (sniffed === undefined) {
    throw new OperationConfigurationError(
      'attachment content signature does not match any approved type',
    );
  }
  if (sniffed !== contentType) {
    // A declared type whose bytes carry a different (or no) signature is a
    // spoofed MIME declaration; fail closed.
    throw new OperationConfigurationError(
      'attachment contentType does not match the content signature',
    );
  }
  return Object.freeze({
    filename,
    contentType,
    content,
  });
}

/**
 * Bind validated attachments to their conversation and uploader credential
 * atomically: every input is validated before any descriptor is produced,
 * so a rejection leaves no partial binding. The binding is metadata-only.
 */
export function bindCaveAttachments(
  conversationId: unknown,
  uploaderCredentialId: unknown,
  attachments: readonly unknown[],
): CaveAttachmentBinding {
  const validatedConversationId = validateReferenceId(
    conversationId,
    'conversationId',
  );
  const validatedCredentialId = validateReferenceId(
    uploaderCredentialId,
    'uploaderCredentialId',
  );
  if (!Array.isArray(attachments) || attachments.length === 0) {
    throw new OperationConfigurationError(
      'attachment binding requires at least one attachment',
    );
  }
  if (attachments.length > CAVE_ATTACHMENT_LIMITS.maxFiles) {
    throw new OperationConfigurationError(
      `attachment upload accepts at most ${CAVE_ATTACHMENT_LIMITS.maxFiles} files`,
    );
  }

  const descriptors: CaveAttachmentDescriptor[] = [];
  let totalBytes = 0;
  for (const input of attachments) {
    const validated = validateAttachmentInput(input);
    totalBytes += validated.content.length;
    if (totalBytes > CAVE_ATTACHMENT_LIMITS.maxRequestBytes) {
      throw new OperationConfigurationError(
        `attachment upload must be at most ${CAVE_ATTACHMENT_LIMITS.maxRequestBytes} bytes in total`,
      );
    }
    descriptors.push(
      Object.freeze({
        filename: validated.filename,
        contentType: validated.contentType,
        sizeBytes: validated.content.length,
      }),
    );
  }

  return Object.freeze({
    conversationId: validatedConversationId,
    uploaderCredentialId: validatedCredentialId,
    attachments: Object.freeze(descriptors),
    totalBytes,
  });
}

const UPLOAD_REQUEST_KEYS = new Set([
  'operationId',
  'confirmed',
  'conversationId',
  'uploaderCredentialId',
  'attachments',
]);

/**
 * Parse and fully validate one attachment upload request. Validation is
 * fail-closed and total: any malformed field rejects the whole request, and
 * the caller performs zero transport work on rejection.
 */
export function parseCaveAttachmentUploadRequest(
  value: unknown,
): CaveAttachmentUploadRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OperationConfigurationError(
      'uploadAttachment request must be an object',
    );
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!UPLOAD_REQUEST_KEYS.has(key)) {
      throw new OperationConfigurationError(
        'uploadAttachment request has an unknown field',
      );
    }
  }
  parsePrivilegedConfirmation({ confirmed: record.confirmed });
  const operationId = validatePrivilegedOperationId(record.operationId);
  if (!Array.isArray(record.attachments)) {
    throw new OperationConfigurationError(
      'uploadAttachment request requires attachments',
    );
  }
  const sourceAttachments = record.attachments;
  const binding = bindCaveAttachments(
    record.conversationId,
    record.uploaderCredentialId,
    sourceAttachments,
  );
  return Object.freeze({
    operationId,
    confirmed: true,
    conversationId: binding.conversationId,
    uploaderCredentialId: binding.uploaderCredentialId,
    attachments: binding.attachments.map((descriptor, index) => {
      const source = sourceAttachments[index] as CaveAttachmentContent;
      return Object.freeze({
        filename: descriptor.filename,
        contentType: descriptor.contentType,
        content: source.content,
      });
    }),
  });
}

const DOWNLOAD_REQUEST_KEYS = new Set([
  'operationId',
  'confirmed',
  'conversationId',
  'attachmentId',
  'maxBytes',
]);

/**
 * Parse one bounded attachment download request. The byte ceiling is
 * mandatory in effect: when omitted it defaults to `maxFileBytes`, and a
 * larger value is rejected.
 */
export function parseCaveAttachmentDownloadRequest(
  value: unknown,
): CaveAttachmentDownloadRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OperationConfigurationError(
      'downloadAttachment request must be an object',
    );
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!DOWNLOAD_REQUEST_KEYS.has(key)) {
      throw new OperationConfigurationError(
        'downloadAttachment request has an unknown field',
      );
    }
  }
  parsePrivilegedConfirmation({ confirmed: record.confirmed });
  const operationId = validatePrivilegedOperationId(record.operationId);
  const conversationId = validateReferenceId(
    record.conversationId,
    'conversationId',
  );
  const attachmentId = validateReferenceId(record.attachmentId, 'attachmentId');
  let maxBytes = CAVE_ATTACHMENT_LIMITS.maxFileBytes;
  if (record.maxBytes !== undefined) {
    if (
      !Number.isSafeInteger(record.maxBytes) ||
      (record.maxBytes as number) <= 0
    ) {
      throw new OperationConfigurationError(
        'downloadAttachment maxBytes must be a positive integer',
      );
    }
    if ((record.maxBytes as number) > CAVE_ATTACHMENT_LIMITS.maxFileBytes) {
      throw new OperationConfigurationError(
        `downloadAttachment maxBytes must be at most ${CAVE_ATTACHMENT_LIMITS.maxFileBytes} bytes`,
      );
    }
    maxBytes = record.maxBytes as number;
  }
  return Object.freeze({
    operationId,
    confirmed: true,
    conversationId,
    attachmentId,
    maxBytes,
  });
}

const RECORD_KEYS = new Set([
  'attachmentId',
  'conversationId',
  'uploaderCredentialId',
  'filename',
  'contentType',
  'sizeBytes',
  'digestSha256',
]);

/**
 * Parse a canonical attachment record from a transport response. Exact keys:
 * a record carrying a `content` (or any unknown) field is rejected, so bytes
 * cannot re-enter canonical state through the record type.
 */
export function parseCaveAttachmentRecord(value: unknown): CaveAttachmentRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CaveAttachmentSchemaError('attachmentRecord');
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!RECORD_KEYS.has(key)) {
      throw new CaveAttachmentSchemaError(`attachmentRecord.${key}`);
    }
  }
  const attachmentId = validateReferenceId(
    record.attachmentId,
    'attachmentId',
  );
  const conversationId = validateReferenceId(
    record.conversationId,
    'conversationId',
  );
  const uploaderCredentialId = validateReferenceId(
    record.uploaderCredentialId,
    'uploaderCredentialId',
  );
  const filename = validateFilename(record.filename);
  const contentType = record.contentType;
  if (
    typeof contentType !== 'string' ||
    !isCaveAttachmentContentType(contentType)
  ) {
    throw new CaveAttachmentSchemaError('attachmentRecord.contentType');
  }
  const sizeBytes = record.sizeBytes;
  if (
    !Number.isSafeInteger(sizeBytes) ||
    (sizeBytes as number) < 0 ||
    (sizeBytes as number) > CAVE_ATTACHMENT_LIMITS.maxFileBytes
  ) {
    throw new CaveAttachmentSchemaError('attachmentRecord.sizeBytes');
  }
  const digestSha256 = validateDigest(record.digestSha256, 'attachmentRecord.digestSha256');
  return Object.freeze({
    attachmentId,
    conversationId,
    uploaderCredentialId,
    filename,
    contentType,
    sizeBytes: sizeBytes as number,
    digestSha256,
  });
}
