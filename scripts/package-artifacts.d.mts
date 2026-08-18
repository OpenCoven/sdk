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
