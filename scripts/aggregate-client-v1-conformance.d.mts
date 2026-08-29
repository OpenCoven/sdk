import type { AggregatedConformanceEvidence } from './conformance-contract.d.mts';

export interface InspectedCaveAssertionEngine {
  commit: string;
  blob: string;
  digest: string;
  moduleUrl: string;
}

export function inspectCaveAssertionEngine(
  caveRoot: string,
): InspectedCaveAssertionEngine;

export function publishEvidenceAtomically(
  outputPath: string,
  bytes: string,
): void;

export function runConformanceAggregation(
  argv?: string[],
): Promise<AggregatedConformanceEvidence>;
