export function isolatedInstallArgs(options?: {
  offline?: boolean;
  workspace?: boolean;
}): string[];

export function runPnpm(
  args: string[],
  cwd: string,
  options?: {
    corepackPath?: string;
    env?: NodeJS.ProcessEnv;
    nodePath?: string;
    stdio?: 'ignore' | 'inherit' | 'pipe';
  },
): void;

export function runPnpmAsync(
  args: string[],
  cwd: string,
  options?: {
    corepackPath?: string;
    env?: NodeJS.ProcessEnv;
    nodePath?: string;
    stdio?: 'ignore' | 'inherit' | 'pipe';
  },
): Promise<void>;

export function installIsolatedOfflineAfterWarming(
  directory: string,
  options?: {
    workspace?: boolean;
  },
): void;

export function installIsolatedConsumersOfflineAfterWarming(
  directories: string[],
  options?: {
    workspace?: boolean;
  },
): Promise<void>;

export function packPublicPackages(options: {
  root: string;
  destinationRoot: string;
  build?: boolean;
  sanitizePublishManifests?: boolean;
  env?: NodeJS.ProcessEnv;
  nodePath?: string;
  corepackPath?: string;
}): Record<string, string>;

export function createPublicPackageBuildInvocation(options: {
  root: string;
  packageMetadata: {
    packageName: string;
    workspaceDirectory: string;
    manifestPath: string;
  };
  nodePath: string;
}): {
  command: string;
  args: string[];
  cwd: string;
};

export function createPublishSafePackageManifest(
  manifest: Record<string, unknown>,
  packageName: string,
): Record<string, unknown>;
