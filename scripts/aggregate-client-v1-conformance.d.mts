import type { AggregatedConformanceEvidence } from './conformance-contract.d.mts';

export interface InspectedCaveAssertionEngine {
  commit: string;
  blob: string;
  digest: string;
  sourceBytes: Buffer;
}

export function inspectCaveAssertionEngine(
  caveRoot: string,
): InspectedCaveAssertionEngine;

export function readTrackedHeadFileAtCommit(
  root: string,
  relativePath: string,
  label: string,
  capturedCommit: string,
): {
  blob: string;
  bytes: Buffer;
  digest: string;
};

export function loadCommittedCaveAssertionEngine(
  inspected: InspectedCaveAssertionEngine,
): Promise<Record<string, unknown>>;

export function fsyncPublicationDirectory(
  directoryPath: string,
  platform?: NodeJS.Platform,
): void;

export function publishPreparedEvidence(
  temporaryPath: string,
  outputPath: string,
  syncDirectory?: (directoryPath: string) => void,
): void;

export function publishEvidenceAtomically(
  outputPath: string,
  bytes: string,
): void;

export function runConformanceAggregation(
  argv?: string[],
): Promise<AggregatedConformanceEvidence>;
