import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const design = readFileSync(
  resolve(
    process.cwd(),
    'docs/superpowers/specs/2026-08-28-sdk-offline-reads-and-tooling-design.md',
  ),
  'utf8',
);

describe('offline tooling design gates', () => {
  test('keeps implementation strictly behind the first public release', () => {
    expect(design).toContain('SDK #41 closes successfully');
    expect(design).toMatch(/no #44\s+implementation work may begin/);
    expect(design).toMatch(/implementation branch or PR may open or merge/);
    expect(design).toMatch(
      /do not begin implementation, create an implementation\s+branch, open an implementation PR, or merge implementation/,
    );
    expect(design).not.toContain('re-sequencing');
  });

  test('fails the Node adapter closed on Windows and keeps Windows trust native', () => {
    expect(design).toContain('The Node reference adapter supports `darwin` and `linux` only');
    expect(design).toContain('On `win32`,');
    expect(design).toContain('before opening the key store');
    expect(design).toContain('synchronously throws `CaveOfflineCacheError`');
    expect(design).toMatch(
      /synchronously throws `CaveOfflineCacheError` with code\s+`cache_identity_unavailable`/,
    );
    expect(design).toContain(
      'performs zero key-store and filesystem I/O before throwing',
    );
    expect(design).toContain(
      'No Windows factory path returns a cache object or result union',
    );
    expect(design).toContain('Windows support belongs exclusively to the managed native-host');
    expect(design).toContain('supported filesystems and exact native mutex');
    expect(design).toContain('Chat Windows native-cache design PR');
    expect(design).toMatch(
      /must merge and\s+receive dedicated native-storage security review before implementation begins/,
    );
    expect(design).toMatch(/Windows cache conformance applies\s+exclusively to Chat/);
    expect(design).not.toContain('CaveWindowsCacheNativeTransactionAdapter');
    expect(design).not.toContain('windowsNative');
    expect(design).not.toContain('windowsPathTrust');
    expect(design).not.toContain('CaveWindowsCachePathTrustValidator');
    expect(design).not.toContain(
      'Node reference adapter returns `cache_identity_unavailable`',
    );
    expect(design).not.toContain('and returns `cache_identity_unavailable`');
  });

  test('uses byte-exact revision and archive encodings across Node and Rust', () => {
    expect(design).toContain('128 UTF-8 bytes');
    expect(design).toContain('128 ASCII bytes are accepted');
    expect(design).toContain('129 ASCII bytes are rejected');
    expect(design).toContain('64 copies of U+00E9 are accepted');
    expect(design).toContain('65 copies of U+00E9 are rejected');
    expect(design).toContain('fileLength === 44 + ciphertextLength + 16');
    expect(design).toContain(
      '00112233-4455-6677-8899-aabbccddeeff',
    );
    expect(design).toContain(
      '00 11 22 33 44 55 66 77 88 99 aa bb cc dd ee ff',
    );
    expect(design).toMatch(
      /61-byte archive with\s+`ciphertextLength = 1` is accepted/,
    );
    expect(design).toMatch(
      /61-byte archive with\s+`ciphertextLength = 17` is rejected/,
    );
    expect(design).toContain('UUID key ID in RFC 4122 network octet order');
    expect(design).toMatch(/Windows GUID mixed-endian\s+field layout is forbidden/);
  });
});
