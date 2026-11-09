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

// Synthetic label-validation inputs; actual Git source binding is tested separately.
const selectedLock = JSON.parse(readFileSync(new URL(
  '../conformance/client-v1-cross-repository-lock.json', import.meta.url,
), 'utf8')) as FrozenConformanceLock;

function candidate(label: string): FrozenConformanceLock {
  const lock = structuredClone(selectedLock) as unknown as SyntheticRunnerLock;
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

test('authenticates the reviewed native compatibility workflow and decoded Windows source', () => {
  const workflow = brotliDecompressSync(readFileSync(new URL(
    './fixtures/chat-ead6fdc-client-v1-conformance.yml.br', import.meta.url,
  ))).toString('utf8');
  const size = 183221;
  const sha256 = '65bfabe1685aa6f6efb9aa7d33e244735fc6230308ac62bc22e7b6f101d0afd4';
  expect(Buffer.byteLength(workflow)).toBe(size);
  expect(createHash('sha256').update(workflow).digest('hex')).toBe(sha256);
  const producer = assertEvidenceProducerCompatibility(candidate('macos-15'));
  producer.workflow.size = size;
  producer.workflow.sha256 = sha256;
  producer.workflow.windowsBootstrapScriptSha256 =
    'ccb5ec6ed8011cdd8bdd1432462583f17cf01db6fb7778c7fe28384ee184d826';
  // Exact workflow bytes and boundaries are checked here. Source ancestry and
  // live execution evidence require their separate verification.
  expect(() => verifyProtectedWorkflow(workflow, producer, selectedLock.toolchain))
    .not.toThrow();
});
