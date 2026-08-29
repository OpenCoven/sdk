import type {
  PublicationArtifactManifest,
} from './create-release-artifacts.mjs';

export interface PublicationSecurityReview {
  schemaVersion: 6;
  kind: 'opencoven-sdk-publication-security-review';
  issue: 'OpenCoven/sdk#40';
  disposition: 'ship';
  reviewer: {
    id: 68980965;
    authorAssociation: 'MEMBER';
    permission: 'admin';
    roleName: 'admin';
    login?: string;
  };
  version: string;
  source: {
    repository: 'OpenCoven/sdk';
    commit: string;
    tree: string;
    runtimeManifest: PublicationArtifactManifest['source']['runtimeManifest'];
  };
  manifest: {
    file: 'release-manifest.json';
    size: number;
    sha256: string;
  };
  packages: PublicationArtifactManifest['packages'];
  toolchain: PublicationArtifactManifest['toolchain'];
  publisher: PublicationArtifactManifest['publisher'];
  provenance: Omit<
    PublicationArtifactManifest['provenance'],
    'artifactName'
  > & {
    jobId: string;
    environmentId: string;
    deploymentId: string;
  };
  artifact: {
    id: string;
    name: string;
    digest: string;
  };
  attestation: {
    job: 'publication-candidate-attestation';
    jobId: string;
    bundle: {
      artifactId: string;
      artifactName: string;
      artifactDigest: string;
      file: 'attestation.json';
      size: number;
      sha256: string;
    };
  };
  commentId?: string;
}

export function createPublicationAuthorizationRecord(options: {
  artifactId: string;
  artifactDigest: string;
  attestationJobId: string;
  attestationBundle: {
    artifactId: string;
    artifactDigest: string;
    file: 'attestation.json';
    size: number;
    sha256: string;
  };
  deploymentId: string;
  environmentId: string;
  jobId: string;
  manifest: PublicationArtifactManifest;
  manifestText: string;
}): PublicationSecurityReview;

export function resolvePublicationSecurityReview(options: {
  root?: string;
  commentId: string;
  allowedArtifactRoot?: string;
  allowedArtifactRoots?: Array<string | undefined>;
  execute?: typeof import('node:child_process').execFileSync;
  env?: NodeJS.ProcessEnv;
}): PublicationSecurityReview;

export function verifyPublicationSecurityReview(options: {
  root?: string;
  artifactRoot: string;
  attestationRoot: string;
  commentId: string;
  allowedArtifactRoots?: Array<string | undefined>;
  execute?: typeof import('node:child_process').execFileSync;
  env?: NodeJS.ProcessEnv;
}): {
  authorization: PublicationSecurityReview;
  manifest: PublicationArtifactManifest;
};

export function main(arguments_?: string[]): PublicationSecurityReview;
