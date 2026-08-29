import type {
  PublicationArtifactManifest,
} from './create-release-artifacts.mjs';

export interface PublicationSecurityReview {
  schemaVersion: 2;
  kind: 'opencoven-sdk-publication-security-review';
  issue: 'OpenCoven/sdk#40';
  disposition: 'ship';
  version: string;
  source: {
    repository: 'OpenCoven/sdk';
    commit: string;
    tree: string;
  };
  manifest: {
    file: 'release-manifest.json';
    size: number;
    sha256: string;
  };
  packages: PublicationArtifactManifest['packages'];
  toolchain: PublicationArtifactManifest['toolchain'];
  provenance: Omit<
    PublicationArtifactManifest['provenance'],
    'artifactName'
  > & {
    jobId: string;
  };
  artifact: {
    id: string;
    name: string;
  };
  commentId?: string;
  reviewer?: 'BunsDev';
}

export function createPublicationAuthorizationRecord(options: {
  artifactId: string;
  jobId: string;
  manifest: PublicationArtifactManifest;
  manifestText: string;
}): PublicationSecurityReview;

export function resolvePublicationSecurityReview(options: {
  root?: string;
  commentId: string;
  allowedArtifactRoot?: string;
  execute?: typeof import('node:child_process').execFileSync;
  env?: NodeJS.ProcessEnv;
}): PublicationSecurityReview;

export function verifyPublicationSecurityReview(options: {
  root?: string;
  artifactRoot: string;
  commentId: string;
  execute?: typeof import('node:child_process').execFileSync;
  env?: NodeJS.ProcessEnv;
}): {
  authorization: PublicationSecurityReview;
  manifest: PublicationArtifactManifest;
};

export function main(arguments_?: string[]): PublicationSecurityReview;
