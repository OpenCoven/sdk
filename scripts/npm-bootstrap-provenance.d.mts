export const MAX_NPM_PROVENANCE_BYTES: number;

export interface NpmProvenanceEntry {
  packageName: string;
  subjectName: string;
  sha512: string;
  bundle: {
    artifactId: string;
    artifactName: string;
    artifactDigest: string;
    file: 'attestation.json';
    size: number;
    sha256: string;
  };
}

export interface NpmProvenanceIdentity {
  source: { commit: string };
  provenance: { sourceRef: string; runId: string; runAttempt: number };
}

export interface NpmProvenanceFacts {
  eventName: string;
  repositoryId: string;
  repositoryOwnerId: string;
}

export function normalizeNpmProvenance(entries: unknown, context: {
  packages: Array<{ name: string; version: string; sha512: string }>;
  version: string;
  commit: string;
  artifactIds: string[];
}): NpmProvenanceEntry[];

export function parseNpmProvenanceBundle(
  bytes: Buffer,
  entry: NpmProvenanceEntry,
  identity: NpmProvenanceIdentity,
  facts: NpmProvenanceFacts,
): { bundle: Record<string, unknown>; statement: Record<string, unknown> };

/** Input must come directly from successful gh attestation trusted-root (TUF), never a caller root. */
export function selectPublicGoodTrustRoot(text: string): string;

export function verifyNpmProvenanceArchive(
  archive: Buffer,
  bundleBytes: Buffer,
  expected: NpmProvenanceEntry['bundle'],
): void;

export interface NpmProvenanceAuthorization extends NpmProvenanceIdentity {
  version: string;
  packages: Array<{
    name: string; version: string; file: string; size: number; sha256: string; sha512: string;
  }>;
  npmProvenance: NpmProvenanceEntry[];
  provenance: NpmProvenanceIdentity['provenance'] & { job: string; jobId: string };
  artifact: { id: string };
  attestation: { job: string; jobId: string; bundle: { artifactId: string } };
  environmentPolicy: { repository: { id: string; owner: { id: string } } };
}

export type NpmProvenanceExecute = (
  command: string,
  args: readonly string[],
  options?: import('node:child_process').ExecFileSyncOptions,
) => string | Buffer;

/** Supplemental verification; retain and recheck the byte snapshots after the final full SHIP review. */
export function verifyNpmProvenanceBundles(options: {
  authorization: NpmProvenanceAuthorization;
  artifactRoot: string;
  npmProvenanceRoot: string;
  execute?: NpmProvenanceExecute;
  env?: NodeJS.ProcessEnv;
}): { entries: NpmProvenanceEntry[]; assertUnchanged: () => void };
