import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function readDocument(name: string): string {
  return readFileSync(resolve(root, name), 'utf8');
}

describe('release and support policies', () => {
  test('defines the supported runtime and maintenance line', () => {
    const support = readDocument('SUPPORT.md');

    expect(support).toContain('Node.js 24');
    expect(support).toContain('>=24.18.0 <25');
    expect(support).toContain('latest minor');
    expect(support).toContain('no service-level agreement');
  });

  test('routes vulnerabilities through private reporting', () => {
    const security = readDocument('SECURITY.md');

    expect(security).toContain('private vulnerability reporting');
    expect(security).toContain('Do not open a public issue');
    expect(security).toContain('redact');
  });

  test('documents bootstrap, trusted publishing, rollback, and incidents', () => {
    const releasing = readDocument('RELEASING.md');

    expect(releasing).toContain('First-publish bootstrap');
    expect(releasing).toContain('npm-release');
    expect(releasing).toContain('trusted publisher');
    expect(releasing).toContain('deprecate');
    expect(releasing).toContain('incident response');
    expect(releasing).toContain('revoke');
    expect(releasing).toContain('does not publish packages');
    expect(releasing).toContain('creates four tarballs');
    expect(releasing).toContain(
      '`@opencoven/dev-cli` is not part of the 0.1 release group',
    );
  });

  test('links policies without claiming publication readiness', () => {
    const readme = readDocument('README.md');

    expect(readme).toContain('[Support policy](SUPPORT.md)');
    expect(readme).toContain('[Security policy](SECURITY.md)');
    expect(readme).toContain('[Release process](RELEASING.md)');
    expect(readme).toContain('not published');
  });
});
