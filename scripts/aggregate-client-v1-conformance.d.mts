import type {
  AggregatedConformanceEvidence,
  CheckoutIdentity,
} from './conformance-contract.d.mts';

export interface InspectedCheckout extends CheckoutIdentity {
  root: string;
}

export interface InspectedTrackedFile {
  blob: string;
  bytes: Buffer;
  size: number;
  sha256: string;
}

export interface InspectedCaveAssertionEngine extends InspectedCheckout {
  blob: string;
  digest: string;
  size: number;
  sourceBytes: Buffer;
}

export function inspectRepositoryCheckout(
  root: string,
  expected: {
    repository: string;
    commit?: string;
    tree?: string;
  },
  label: string,
): InspectedCheckout;

export function readTrackedFileAtCommit(
  root: string,
  relativePath: string,
  label: string,
  capturedCommit: string,
): InspectedTrackedFile;

export function inspectCaveAssertionEngine(
  caveRoot: string,
  expectedIdentity?: {
    repository: string;
    commit?: string;
    tree?: string;
  },
): InspectedCaveAssertionEngine;

export function loadCommittedCaveAssertionEngine(
  inspected: Pick<
    InspectedCaveAssertionEngine,
    'digest' | 'sourceBytes'
  >,
): Promise<Record<string, unknown>>;

export function assertAggregationHostPlatform(
  platform?: NodeJS.Platform,
): void;

export function fsyncPublicationDirectory(
  directoryPath: string,
  platform?: NodeJS.Platform,
  expectedIdentity?: {
    dev: number;
    ino: number;
  },
): void;

export function publishEvidenceAtomically(
  outputRoot: string,
  outputName: string,
  bytes: string,
  options?: {
    platform?: NodeJS.Platform;
    afterTempFsyncBeforeCommit?: () => void;
    beforeLink?: () => void;
    afterPreparedVerifyBeforeLink?: () => void;
    afterLinkBeforeVerify?: () => void;
    afterLink?: () => void;
    afterTempUnlinkBeforeFinalVerify?: () => void;
  },
): string;

export function runConformanceAggregation(
  argv?: string[],
): Promise<AggregatedConformanceEvidence>;
