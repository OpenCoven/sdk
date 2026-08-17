import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('artifact reservation', () => {
  test('reserves the root .artifacts directory for untracked scratch files', () => {
    expect(readFileSync(resolve(root, '.gitignore'), 'utf8')).toContain('.artifacts/');
    expect(
      execFileSync(
        'git',
        ['-C', root, 'check-ignore', '-v', '--no-index', '.artifacts/reservation-probe/file.txt'],
        { encoding: 'utf8' },
      ),
    ).toContain('.artifacts/');
    expect(execFileSync('git', ['-C', root, 'ls-files', '--', '.artifacts'], { encoding: 'utf8' })).toBe('');
  });
});
