export interface ApiSurface {
  packageName: string;
  declaration: string;
  packageExports: Record<string, unknown>;
  runtimeExports: string[];
}

export interface ApiBaseline extends ApiSurface {
  version: 1;
}

export const API_BASELINE_VERSION: 1;

export function isJsonOrderEqual(left: unknown, right: unknown): boolean;

export function apiBaselinePaths(
  root: string,
  workspaceDirectory: string,
): {
  declaration: string;
  metadata: string;
};

export function readApiBaseline(
  root: string,
  workspaceDirectory: string,
): ApiBaseline;

export function createApiBaseline(input: {
  declaration: string;
  packageExports: Record<string, unknown>;
  packageName: string;
  runtimeExports: string[];
}): ApiBaseline;

export function assertApiBaseline(
  expected: unknown,
  actual: ApiSurface,
): void;

export function readPackedApiSurfaces(input: {
  artifactRoot: string;
  packages: readonly {
    packageName: string;
    workspaceDirectory: string;
  }[];
  tarballs: Record<string, string>;
}): Promise<Record<string, ApiBaseline>>;
