import type {
  AggregatedConformanceEvidence,
  CaveAssertionEngine,
  FrozenConformanceLock,
  ReviewedEvidenceIndex,
} from './conformance-contract.mjs';

export interface GitHubConformanceVerification {
  aggregate: AggregatedConformanceEvidence;
  index: ReviewedEvidenceIndex;
  receipt: Record<string, unknown>;
}

export function verifyProtectedWorkflow(
  text: string,
  producer: Extract<
    FrozenConformanceLock['evidenceProducer'],
    { status: 'compatible' }
  >,
  toolchain: FrozenConformanceLock['toolchain'],
): void;

export function verifyGitHubConformanceEvidence(options: {
  frozenLockText: string;
  assertionRegistryText: string;
  schemaText: string;
  aggregatePath: string;
  aggregateText: string;
  indexText: string;
  caveEngine: CaveAssertionEngine;
  execute?: typeof import('node:child_process').execFileSync;
  env?: NodeJS.ProcessEnv;
}): GitHubConformanceVerification;
