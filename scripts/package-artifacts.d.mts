export function isolatedInstallArgs(options?: {
  offline?: boolean;
  workspace?: boolean;
}): string[];

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
  env?: NodeJS.ProcessEnv;
}): Record<string, string>;
