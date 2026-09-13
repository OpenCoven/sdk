import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { decodeWindowsSupervisorSource, renderWindowsSupervisorSource } from '../scripts/windows-supervisor-source.mjs';

const source = brotliDecompressSync(readFileSync(new URL('./fixtures/chat-debee-windows-supervisor.cs.br', import.meta.url)));
const identity = { size: 349530, sha256: 'b7ec5455ad394b58cafd93cc85c7e87da37b04cdbd6f936aad0a1768432064df' };

describe('reviewed compressed Windows supervisor source', () => {
  test('binds the canonical decoded block to the independent frozen C# identity', () => {
    expect(source.length).toBe(identity.size);
    expect(createHash('sha256').update(source).digest('hex')).toBe(identity.sha256);
    expect(decodeWindowsSupervisorSource(renderWindowsSupervisorSource(source), identity)).toEqual(source);
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
