import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { decodeWindowsSupervisorSource, renderWindowsSupervisorSource } from '../scripts/windows-supervisor-source.mjs';

const source = brotliDecompressSync(readFileSync(new URL('./fixtures/chat-debee-windows-supervisor.cs.br', import.meta.url)));
const identity = { size: 351497, sha256: '281acdeba5ee8dd022fd0451bd4ede6af8431aba8810f1683ce7077cc627fcb0' };

describe('reviewed compressed Windows supervisor source', () => {
  test('binds the canonical decoded block to the independent frozen C# identity', () => {
    expect(source.length).toBe(identity.size);
    expect(createHash('sha256').update(source).digest('hex')).toBe(identity.sha256);
    expect(decodeWindowsSupervisorSource(renderWindowsSupervisorSource(source), identity)).toEqual(source);
    const bootstrap = brotliDecompressSync(readFileSync(new URL('./fixtures/chat-8856ad-windows-bootstrap.ps1.br', import.meta.url))).toString('utf8');
    const blocks = bootstrap.match(/^# BEGIN bounded Windows supervisor source v1\n[\s\S]*?^# END bounded Windows supervisor source v1$/gmu);
    expect(blocks).toHaveLength(1);
    expect(decodeWindowsSupervisorSource(blocks![0], identity)).toEqual(source);
  });

  test('rejects source and decoder changes despite valid compressed input', () => {
    const block = renderWindowsSupervisorSource(source);
    for (const changed of [
      block.replace('ReadByte() -ne -1', 'ReadByte() -ne -2'),
      block.replace('$jobSupervisorSource =', "$jobSupervisorSource = 'other'; $unused ="),
      `${block}\nAdd-Type -TypeDefinition 'other'`,
      renderWindowsSupervisorSource(Buffer.from('public class Other {}')),
    ]) expect(() => decodeWindowsSupervisorSource(changed, identity)).toThrow();
  });
});
