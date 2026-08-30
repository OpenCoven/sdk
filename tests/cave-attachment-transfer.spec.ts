import { createHash } from 'node:crypto';

import {
  CAVE_ATTACHMENT_LIMITS,
  bindCaveAttachments,
  parseCaveAttachmentDownloadRequest,
  parseCaveAttachmentRecord,
  parseCaveAttachmentUploadRequest,
  sniffCaveAttachmentContentType,
  type CaveAttachmentContent,
} from '@opencoven/cave-client';
import { OperationConfigurationError } from '@opencoven/sdk-core/browser';
import { describe, expect, test } from 'vitest';

const OPERATION_ID = '018f4f1a-77c2-7a31-8a15-55a25aaba001';

function png(): Uint8Array {
  // Minimal PNG magic followed by filler content.
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82,
  ]);
}

function jpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
}

function elf(): Uint8Array {
  return new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
}

function text(content = 'hello world\n'): Uint8Array {
  return new TextEncoder().encode(content);
}

function webp(): Uint8Array {
  const bytes = new Uint8Array(12);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP" at offset 8
  return bytes;
}

function attachment(overrides: Record<string, unknown> = {}): CaveAttachmentContent {
  return {
    filename: 'notes.txt',
    contentType: 'text/plain',
    content: text(),
    ...overrides,
  };
}

function digestOf(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('attachment content signatures', () => {
  test('the canonical byte digest belongs to Cave, not the SDK', () => {
    // Descriptors carry no digest field: Cave hashes the bytes server-side
    // where they land. The record parser validates the digest string only.
    const binding = bindCaveAttachments('conversation.v1', 'credential.v1', [
      attachment(),
    ]);
    expect(JSON.stringify(binding)).not.toContain('digest');
  });
  test('sniffs every approved signature', () => {
    expect(sniffCaveAttachmentContentType(png())).toBe('image/png');
    expect(sniffCaveAttachmentContentType(jpeg())).toBe('image/jpeg');
    expect(sniffCaveAttachmentContentType(new TextEncoder().encode('GIF87a'))).toBe(
      'image/gif',
    );
    expect(sniffCaveAttachmentContentType(new TextEncoder().encode('GIF89a'))).toBe(
      'image/gif',
    );
    expect(sniffCaveAttachmentContentType(webp())).toBe('image/webp');
    expect(sniffCaveAttachmentContentType(new TextEncoder().encode('%PDF-1.7\n'))).toBe(
      'application/pdf',
    );
    expect(sniffCaveAttachmentContentType(text())).toBe('text/plain');
    expect(
      sniffCaveAttachmentContentType(new TextEncoder().encode('multi\nline étext\n')),
    ).toBe('text/plain');
  });

  test('rejects executable and unknown signatures as unmatched', () => {
    expect(sniffCaveAttachmentContentType(elf())).toBeUndefined();
    expect(sniffCaveAttachmentContentType(new Uint8Array([0x00, 0x01, 0x02]))).toBeUndefined();
    // "RIFF" without the "WEBP" container magic is not WebP.
    expect(
      sniffCaveAttachmentContentType(new TextEncoder().encode('RIFFxxxxxxxx')),
    ).toBeUndefined();
  });
});

describe('attachment upload validation fails closed', () => {
  test('rejects spoofed MIME declarations', () => {
    for (const spoofed of [
      attachment({ filename: 'evil.png', contentType: 'image/png', content: elf() }),
      attachment({ filename: 'evil.png', contentType: 'image/png', content: jpeg() }),
      attachment({ filename: 'evil.bin', contentType: 'application/octet-stream' }),
      attachment({ filename: 'evil.svg', contentType: 'image/svg+xml', content: text('<svg/>') }),
      attachment({ filename: 'evil.zip', contentType: 'application/zip', content: elf() }),
      attachment({ filename: 'evil.sh', contentType: 'text/x-shellscript' }),
    ]) {
      expect(() =>
        bindCaveAttachments('conversation.v1', 'credential.v1', [spoofed]),
      ).toThrowError(OperationConfigurationError);
    }
  });

  test('rejects traversal and hostile filenames', () => {
    for (const filename of [
      '../etc/passwd',
      '..\\windows\\system32',
      'a/b.txt',
      '.',
      '..',
      '.hidden.txt',
      'trailing.',
      'trailing ',
      'with\0null.txt',
      'bell\x07.txt',
      '',
      'x'.repeat(CAVE_ATTACHMENT_LIMITS.maxFilenameCharacters + 1),
    ]) {
      expect(() =>
        bindCaveAttachments('conversation.v1', 'credential.v1', [
          attachment({ filename }),
        ]),
      ).toThrowError(OperationConfigurationError);
    }

    expect(() =>
      bindCaveAttachments('conversation.v1', 'credential.v1', [attachment()]),
    ).not.toThrowError();
  });

  test('rejects symlinked sources fail closed', () => {
    expect(() =>
      bindCaveAttachments('conversation.v1', 'credential.v1', [
        attachment({ symlink: true }),
      ]),
    ).toThrowError(OperationConfigurationError);
  });

  test('enforces file count, file size, and request size limits', () => {
    const tooMany = Array.from(
      { length: CAVE_ATTACHMENT_LIMITS.maxFiles + 1 },
      () => attachment(),
    );
    expect(() =>
      bindCaveAttachments('conversation.v1', 'credential.v1', tooMany),
    ).toThrowError(OperationConfigurationError);

    const oversized = new Uint8Array(CAVE_ATTACHMENT_LIMITS.maxFileBytes + 1);
    expect(() =>
      bindCaveAttachments('conversation.v1', 'credential.v1', [
        attachment({ content: oversized }),
      ]),
    ).toThrowError(OperationConfigurationError);

    // Valid text attachments whose combined size exceeds the request limit.
    const chunk = new TextEncoder().encode(
      'a'.repeat(Math.floor(CAVE_ATTACHMENT_LIMITS.maxRequestBytes / 3)),
    );
    const nearLimit = Array.from(
      { length: 4 },
      () => attachment({ content: chunk }),
    );
    expect(() =>
      bindCaveAttachments('conversation.v1', 'credential.v1', nearLimit),
    ).toThrowError(OperationConfigurationError);
  });

  test('binds uploader credential and conversation atomically', () => {
    const binding = bindCaveAttachments('conversation.v1', 'credential.v1', [
      attachment(),
      attachment({ filename: 'img.png', contentType: 'image/png', content: png() }),
    ]);

    expect(binding.conversationId).toBe('conversation.v1');
    expect(binding.uploaderCredentialId).toBe('credential.v1');
    expect(binding.attachments.length).toBe(2);
    expect(binding.totalBytes).toBe(text().length + png().length);
    expect(binding.attachments[0]?.sizeBytes).toBe(text().length);
    expect(binding.attachments[1]?.sizeBytes).toBe(png().length);
    expect(Object.keys(binding.attachments[1] ?? {}).sort()).toEqual([
      'contentType',
      'filename',
      'sizeBytes',
    ]);

    // Missing owner fields reject the whole binding.
    for (const [conversationId, credentialId] of [
      ['', 'credential.v1'],
      ['conversation.v1', ''],
      [undefined, 'credential.v1'],
      ['conversation.v1', undefined],
    ] as const) {
      expect(() =>
        bindCaveAttachments(conversationId, credentialId, [attachment()]),
      ).toThrowError(OperationConfigurationError);
    }
  });

  test('the binding is metadata-only: attachment bytes never serialize', () => {
    const binding = bindCaveAttachments('conversation.v1', 'credential.v1', [
      attachment(),
    ]);
    const serialized = JSON.stringify(binding);
    expect(serialized).not.toContain('"content"');
    expect(serialized).not.toContain('"bytes"');
    // The serialized form is valid JSON with only descriptor fields.
    const parsed = JSON.parse(serialized) as { attachments: Array<Record<string, unknown>> };
    for (const descriptor of parsed.attachments) {
      expect(Object.keys(descriptor).sort()).toEqual([
        'contentType',
        'filename',
        'sizeBytes',
      ]);
    }
  });
});

describe('attachment request parsers', () => {
  test('parses a valid upload request and normalizes the operation id', () => {
    const parsed = parseCaveAttachmentUploadRequest({
      operationId: OPERATION_ID.toUpperCase(),
      confirmed: true,
      conversationId: 'conversation.v1',
      uploaderCredentialId: 'credential.v1',
      attachments: [attachment()],
    });
    expect(parsed.operationId).toBe(OPERATION_ID);
    expect(parsed.confirmed).toBe(true);
    expect(parsed.attachments.length).toBe(1);
    expect(parsed.attachments[0]?.filename).toBe('notes.txt');
  });

  test('rejects malformed upload requests before any capability or transport work', () => {
    const base = {
      operationId: OPERATION_ID,
      confirmed: true,
      conversationId: 'conversation.v1',
      uploaderCredentialId: 'credential.v1',
      attachments: [attachment()],
    };
    for (const malformed of [
      { ...base, confirmed: false },
      { ...base, confirmed: 'true' },
      { ...base, operationId: 'not-a-uuid' },
      { ...base, attachments: [] },
      { ...base, uploaderCredentialId: '' },
      { ...base, extra: true },
      { ...base, attachments: 'nope' },
    ]) {
      expect(() => parseCaveAttachmentUploadRequest(malformed)).toThrowError(Error);
    }
  });

  test('parses bounded download requests', () => {
    const parsed = parseCaveAttachmentDownloadRequest({
      operationId: OPERATION_ID,
      confirmed: true,
      conversationId: 'conversation.v1',
      attachmentId: 'attachment-1',
    });
    expect(parsed.maxBytes).toBe(CAVE_ATTACHMENT_LIMITS.maxFileBytes);

    const bounded = parseCaveAttachmentDownloadRequest({
      operationId: OPERATION_ID,
      confirmed: true,
      conversationId: 'conversation.v1',
      attachmentId: 'attachment-1',
      maxBytes: 1024,
    });
    expect(bounded.maxBytes).toBe(1024);

    for (const maxBytes of [0, -1, CAVE_ATTACHMENT_LIMITS.maxFileBytes + 1, 'big']) {
      expect(() =>
        parseCaveAttachmentDownloadRequest({
          operationId: OPERATION_ID,
          confirmed: true,
          conversationId: 'conversation.v1',
          attachmentId: 'attachment-1',
          maxBytes: maxBytes as never,
        }),
      ).toThrowError(OperationConfigurationError);
    }
  });
});

describe('attachment records', () => {
  const validRecord = {
    attachmentId: 'attachment-1',
    conversationId: 'conversation.v1',
    uploaderCredentialId: 'credential.v1',
    filename: 'notes.txt',
    contentType: 'text/plain',
    sizeBytes: 5,
    digestSha256: digestOf(text('hello')),
  };

  test('parses a canonical record', () => {
    const record = parseCaveAttachmentRecord(validRecord);
    expect(record.attachmentId).toBe('attachment-1');
    expect(record.uploaderCredentialId).toBe('credential.v1');
  });

  test('rejects byte-bearing or malformed records with exact keys', () => {
    // A record can never carry bytes back into canonical state.
    expect(() =>
      parseCaveAttachmentRecord({ ...validRecord, content: text('hello') }),
    ).toThrowError(/malformed/u);
    expect(() =>
      parseCaveAttachmentRecord({ ...validRecord, bytes: [1, 2, 3] }),
    ).toThrowError(/malformed/u);
    expect(() =>
      parseCaveAttachmentRecord({ ...validRecord, sizeBytes: -1 }),
    ).toThrowError(/malformed/u);
    expect(() =>
      parseCaveAttachmentRecord({ ...validRecord, digestSha256: 'deadbeef' }),
    ).toThrowError(/malformed/u);
    expect(() =>
      parseCaveAttachmentRecord({ ...validRecord, contentType: 'image/svg+xml' }),
    ).toThrowError(/malformed/u);
    expect(() => parseCaveAttachmentRecord(null)).toThrowError(/malformed/u);
  });
});
