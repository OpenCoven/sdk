export interface ApiEntrypoint {
  declarationFiles: string[];
  runtimeExports: Record<string, string[]>;
}

export interface ApiSurface {
  packageName: string;
  declaration: string;
  packageExports: Record<string, unknown>;
  entrypoints: Record<string, ApiEntrypoint>;
}

export interface ApiBaseline extends ApiSurface {
  version: 2;
}

export const API_BASELINE_VERSION: 2;

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
  entrypoints: Record<string, ApiEntrypoint>;
  packageExports: Record<string, unknown>;
  packageName: string;
}): ApiBaseline;

export function assertApiBaseline(
  expected: unknown,
  actual: ApiSurface,
): void;

export function readPackageApiSurface(input: {
  packageName: string;
  packageRoot: string;
}): Promise<ApiBaseline>;

export function readPackedApiSurfaces(input: {
  artifactRoot: string;
  packages: readonly {
    packageName: string;
    workspaceDirectory: string;
  }[];
  tarballs: Record<string, string>;
}): Promise<Record<string, ApiBaseline>>;
