import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function digest(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('reviewed authority fixtures', () => {
  test('copies the approved Cave fixture bytes and digest', () => {
    const fixture = resolve(root, 'packages/cave/fixtures/contract-fixture.json');
    const digestFile = resolve(root, 'packages/cave/fixtures/contract-fixture.sha256');
    const parsed = JSON.parse(readFileSync(fixture, 'utf8')) as {
      contract: {
        identityKinds: string[];
      };
      examples: Record<string, unknown>;
    };

    expect(digest(fixture)).toBe('806d647f5969e646080713dabaa9d86ac897637e2a823c75085093c5a210a7fe');
    expect(readFileSync(digestFile, 'utf8')).toBe('806d647f5969e646080713dabaa9d86ac897637e2a823c75085093c5a210a7fe\n');
    expect(parsed.contract.identityKinds).toEqual([
      'client',
      'credential',
      'familiar',
      'project',
      'conversation',
      'message',
      'event',
    ]);
    expect(Object.keys(parsed.examples)).toEqual([
      'cursor',
      'discoveryRecord',
      'discoveryRecordV2',
      'errorEnvelope',
      'health',
      'healthEnvelope',
      'identity',
      'pairingCreatedEnvelope',
      'pairingExchangeEnvelope',
      'pairingStatusEnvelope',
      'revision',
      'status',
      'successEnvelope',
    ]);
  });

  test('copies the approved Coven health fixture bytes', () => {
    expect(digest(resolve(root, 'packages/coven/fixtures/health.json'))).toBe(
      '6d339c0796df124579a01debf1f30ac82ad09bc2e68b734b935e3e0e6c19154f',
    );
  });

  test('copies the approved Coven error fixture bytes', () => {
    expect(digest(resolve(root, 'packages/coven/fixtures/error.json'))).toBe(
      '927bfe212e75d6e213780a79e1657033c577c68cdd4119f19ccec944337457c4',
    );
  });
});
