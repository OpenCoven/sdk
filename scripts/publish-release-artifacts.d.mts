import type {
  PublicationArtifactManifest,
} from './create-release-artifacts.mjs';
import type {
  OwnedTempDirectoryContext,
} from './owned-temp-directory.mjs';

export function createNpmPublishArgs(options: {
  tarball: string;
  access: 'public' | 'restricted';
  distTag: string;
  registry: string;
  userconfig: string;
  globalconfig: string;
  cache: string;
}): string[];

export function publishReleaseArtifacts(options?: {
  root?: string;
  artifactRoot?: string;
  pendingApprovalRoot?: string;
  protectedApprovalRoot?: string;
  version?: string;
  env?: Record<string, string | undefined>;
  execute?: (
    command: string,
    arguments_: string[],
    options: {
      cwd: string;
      env: Record<string, string | undefined>;
      encoding?: 'utf8';
      stdio: 'inherit' | ['ignore', 'pipe', 'pipe'];
    },
  ) => unknown;
  githubExecute?: typeof import('node:child_process').execFileSync;
  resolveRuntime?: (
    options: {
      env: Record<string, string | undefined>;
    },
  ) => {
    nodePath: string;
    nodeSize: number;
    nodeSha256: string;
    nodeVersion: string;
    corepackPath: string;
  };
  prepareNpmCli?: (
    options: {
      version: string;
      registry: string;
      runtime: {
        nodePath: string;
      };
      execute: typeof import('node:child_process').execFileSync;
    },
  ) => {
    owned: OwnedTempDirectoryContext;
    cliPath: string;
    treeSha256: string;
  };
}): PublicationArtifactManifest;

export function prepareAuthenticatedNpmCli(options: {
  version: string;
  registry: string;
  runtime: {
    nodePath: string;
  };
  execute?: typeof import('node:child_process').execFileSync;
}): {
  owned: OwnedTempDirectoryContext;
  cliPath: string;
  treeSha256: string;
};

export function main(arguments_?: string[]): PublicationArtifactManifest;
