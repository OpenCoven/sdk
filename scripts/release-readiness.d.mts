export interface ReleaseConfig {
  schemaVersion: 1;
  publishingEnabled: boolean;
  tagPrefix: 'sdk-v';
  npmAccess: 'public';
  npmDistTag: 'latest';
  githubEnvironment: 'npm-release';
  supportedNode: {
    minimum: '24.18.0';
    major: 24;
  };
  packages: string[];
}

export interface ReleaseReadinessOptions {
  root?: string;
  mode?: 'verify' | 'publish';
  version?: string;
  tag?: string;
  requireTag?: boolean;
}

export interface ReleaseReadinessSummary {
  version: string;
  publishingEnabled: boolean;
  packages: string[];
}

export function readReleaseConfig(root?: string): ReleaseConfig;

export function validateReleaseReadiness(
  options?: ReleaseReadinessOptions,
): ReleaseReadinessSummary;
