import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { decodeWindowsSupervisorSource, renderWindowsSupervisorSource } from '../scripts/windows-supervisor-source.mjs';

const source = brotliDecompressSync(readFileSync(new URL('./fixtures/chat-debee-windows-supervisor.cs.br', import.meta.url)));
const identity = { size: 397084, sha256: 'ec56ad9daf9cfd2e92de4420cfc5ce328e09a76b627a8253ef35f2e9ef151669' };

// Rendering and decoding are deliberately expensive: `renderWindowsSupervisorSource`
// gzips the complete source at level 9, and every `decodeWindowsSupervisorSource` call
// re-renders it to bind the decoder statements as well as the canonical gzip bytes.
// The fixtures and the one shared canonical block are therefore built once at module
// scope rather than per test, and the remaining in-test re-renders carry an explicit
// timeout: the default 5s has been exceeded on loaded parallel Windows runners.
// Nothing here weakens the re-render check; it is the point of the suite.
const block = renderWindowsSupervisorSource(source);
const bootstrap = brotliDecompressSync(readFileSync(new URL('./fixtures/chat-8856ad-windows-bootstrap.ps1.br', import.meta.url))).toString('utf8');
const bootstrapBlocks = bootstrap.match(/^# BEGIN bounded Windows supervisor source v1\n[\s\S]*?^# END bounded Windows supervisor source v1$/gmu);

describe('reviewed compressed Windows supervisor source', { timeout: 30_000 }, () => {
  test('binds the canonical decoded block to the independent frozen C# identity', () => {
    expect(source.length).toBe(identity.size);
    expect(createHash('sha256').update(source).digest('hex')).toBe(identity.sha256);
    expect(decodeWindowsSupervisorSource(block, identity)).toEqual(source);
    expect(bootstrapBlocks).toHaveLength(1);
    expect(decodeWindowsSupervisorSource(bootstrapBlocks![0], identity)).toEqual(source);
  });

  test('rejects source and decoder changes despite valid compressed input', () => {
    for (const changed of [
      block.replace('ReadByte() -ne -1', 'ReadByte() -ne -2'),
      block.replace('$jobSupervisorSource =', "$jobSupervisorSource = 'other'; $unused ="),
      `${block}\nAdd-Type -TypeDefinition 'other'`,
      renderWindowsSupervisorSource(Buffer.from('public class Other {}')),
    ]) expect(() => decodeWindowsSupervisorSource(changed, identity)).toThrow();
  });
});
