import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { decodeWindowsSupervisorSource, renderWindowsSupervisorSource } from '../scripts/windows-supervisor-source.mjs';

const source = brotliDecompressSync(readFileSync(new URL('./fixtures/chat-7cee89-windows-supervisor.cs.br', import.meta.url)));
const identity = { size: 329192, sha256: 'de5b7861f8a6f219ce04d7bf7fd83559765d50c1ff1c9bf14f47259198940cb3' };

describe('reviewed compressed Windows supervisor source', () => {
  test('binds the canonical decoded block to the independent frozen C# identity', () => {
    expect(source.length).toBe(identity.size);
    expect(createHash('sha256').update(source).digest('hex')).toBe(identity.sha256);
    expect(decodeWindowsSupervisorSource(renderWindowsSupervisorSource(source), identity)).toEqual(source);
  });

  test('rejects source and decoder changes despite valid compressed input', () => {
    const block = renderWindowsSupervisorSource(source);
    for (const changed of [
      renderWindowsSupervisorSource(
        Buffer.from(
          source.toString('utf8').replace(
            'information.SessionId == 0)',
            'information.SessionId != 0)',
          ),
        ),
      ),
      renderWindowsSupervisorSource(
        Buffer.from(
          source.toString('utf8').replace(
            [
              '"WTS process primary token SID query was ambiguous "',
              '                                + "for process {0} in session {1}.",',
            ].join('\n'),
            '"WTS process primary token SID query was ambiguous.",',
          ),
        ),
      ),
      block.replace('ReadByte() -ne -1', 'ReadByte() -ne -2'),
      block.replace('$jobSupervisorSource =', "$jobSupervisorSource = 'other'; $unused ="),
      `${block}\nAdd-Type -TypeDefinition 'other'`,
      renderWindowsSupervisorSource(Buffer.from('public class Other {}')),
    ]) expect(() => decodeWindowsSupervisorSource(changed, identity)).toThrow();
  });
});
