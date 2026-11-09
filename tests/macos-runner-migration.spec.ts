import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { expect, test } from 'vitest';

import {
  assertEvidenceProducerCompatibility,
  type FrozenConformanceLock,
} from '../scripts/conformance-contract.mjs';
import { verifyProtectedWorkflow } from '../scripts/github-conformance-evidence.mjs';

type SyntheticRunnerLock = {
  evidenceProducer: {
    workflow: { runnerLabels: Record<string, string[]> };
  };
};

// Synthetic label-validation inputs, not rebound or accepted producer evidence.
// Real source identities must be bound after the coordinated Chat merge.
const historical = JSON.parse(readFileSync(new URL(
  '../conformance/client-v1-cross-repository-lock.json', import.meta.url,
), 'utf8')) as FrozenConformanceLock;

function candidate(label: string): FrozenConformanceLock {
  const lock = structuredClone(historical) as unknown as SyntheticRunnerLock;
  lock.evidenceProducer.workflow.runnerLabels['darwin-arm64'] = [label];
  // Deliberately admit invalid labels to exercise runtime validation.
  return lock as unknown as FrozenConformanceLock;
}

test('accepts the supported macOS Arm64 runner and preserves other platforms', () => {
  const producer = assertEvidenceProducerCompatibility(candidate('macos-15'));
  expect(producer.workflow.runnerLabels).toEqual({
    'darwin-arm64': ['macos-15'],
    'linux-x64': ['ubuntu-24.04'],
    'win32-x64': ['windows-2025'],
  });
});

test.each(['macos-14', 'macos-latest', 'macos-15-intel', 'self-hosted'])(
  'rejects unreviewed Darwin runner %s',
  (label) => {
    expect(() => assertEvidenceProducerCompatibility(candidate(label))).toThrow();
  },
);

test('authenticates the reviewed migration workflow and decoded Windows source', () => {
  const workflow = brotliDecompressSync(readFileSync(new URL(
    './fixtures/chat-4921141-client-v1-conformance.yml.br', import.meta.url,
  ))).toString('utf8');
  const size = 183220;
  const sha256 = '56ca0b00264e465aea76b274fbec7c4366290ab0de03dbe6f1f1760d586d2978';
  expect(Buffer.byteLength(workflow)).toBe(size);
  expect(createHash('sha256').update(workflow).digest('hex')).toBe(sha256);
  const producer = assertEvidenceProducerCompatibility(candidate('macos-15'));
  producer.workflow.size = size;
  producer.workflow.sha256 = sha256;
  producer.workflow.windowsBootstrapScriptSha256 =
    'ccb5ec6ed8011cdd8bdd1432462583f17cf01db6fb7778c7fe28384ee184d826';
  // This validates exact fixture bytes and every workflow boundary; it does not
  // claim that the historical producer identities are rebound or merged.
  expect(() => verifyProtectedWorkflow(workflow, producer, historical.toolchain))
    .not.toThrow();
});
