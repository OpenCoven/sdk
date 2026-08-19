import type { ReleaseArtifactManifest } from './create-release-artifacts.mjs';

export function createNpmPublishArgs(options: {
  tarball: string;
  access: 'public' | 'restricted';
  distTag: string;
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
      stdio: 'inherit';
    },
  ) => unknown;
}): ReleaseArtifactManifest;

export function main(arguments_?: string[]): ReleaseArtifactManifest;
