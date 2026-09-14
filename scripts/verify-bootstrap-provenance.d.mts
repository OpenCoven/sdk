import type { NpmProvenanceEntry } from './npm-bootstrap-provenance.mjs';

export interface BootstrapProvenanceVerification {
  kind: 'opencoven-sdk-bootstrap-provenance-verification';
  commentId: string;
  version: string;
  source: { commit: string; tree: string };
  sourceRef: string;
  runId: string;
  runAttempt: number;
  trust: 'sigstore-public-good-only';
  npmProvenance: NpmProvenanceEntry[];
  bootstrapApproval: 'separate-human-gate-required';
}

export function verifyBootstrapProvenance(options: {
  root?: string;
  commentId: string;
  artifactRoot: string;
  attestationRoot: string;
  /** Exactly four directories named 0, 1, 2, 3, each containing only attestation.json. */
  npmProvenanceRoot: string;
  execute?: typeof import('node:child_process').execFileSync;
  env?: NodeJS.ProcessEnv;
}): BootstrapProvenanceVerification;

export function main(arguments_?: string[]): BootstrapProvenanceVerification;
