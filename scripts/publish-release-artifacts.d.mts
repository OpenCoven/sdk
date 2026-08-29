import type {
  PublicationArtifactManifest,
} from './create-release-artifacts.mjs';

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
}): PublicationArtifactManifest;

export function main(arguments_?: string[]): PublicationArtifactManifest;
