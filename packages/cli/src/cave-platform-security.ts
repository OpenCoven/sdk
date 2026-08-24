import {
  discoverCaveEndpoint,
  type CaveDiscoveredClientOptions,
} from '@opencoven/cave-client';

import type { ResolvedCliRuntime } from './main.js';

const DEFAULT_CLI_CAVE_DISCOVERY = Symbol.for('@opencoven/dev-cli/default-cave-discovery');

function hasWindowsPathTrust(
  runtime: Pick<ResolvedCliRuntime, 'discoveryOptions'>,
): boolean {
  const validator = runtime.discoveryOptions.cave?.dependencies?.windowsPathTrust;
  return validator !== undefined && typeof validator.validate === 'function';
}

function isDefaultCliCaveDiscoverEndpoint(value: unknown): boolean {
  if (
    (typeof value !== 'function' && typeof value !== 'object') ||
    value === null
  ) {
    return false;
  }

  try {
    return Reflect.get(value, DEFAULT_CLI_CAVE_DISCOVERY) === true;
  } catch {
    return false;
  }
}

export function createDefaultCliCaveDiscoverEndpoint(): NonNullable<
  CaveDiscoveredClientOptions['discoverEndpoint']
> {
  const discover = async (
    options?: CaveDiscoveredClientOptions['discovery'],
  ) => await discoverCaveEndpoint(options);

  Object.defineProperty(discover, DEFAULT_CLI_CAVE_DISCOVERY, { value: true });
  return discover;
}

export function missingCliCavePlatformSecurity(
  runtime: Pick<ResolvedCliRuntime, 'cave' | 'discoveryOptions' | 'platform'>,
): Error | undefined {
  if (runtime.platform !== 'win32') {
    return undefined;
  }

  if (!isDefaultCliCaveDiscoverEndpoint(runtime.cave.discoverEndpoint)) {
    return undefined;
  }

  if (hasWindowsPathTrust(runtime)) {
    return undefined;
  }

  return Object.assign(
    new Error('Reviewed native Windows Cave path trust validation is unavailable.'),
    {
      code: 'platform_security_unavailable',
      retryable: false,
      details: {
        platform: 'windows',
        requirement: 'path_ownership_acl',
      },
      diagnostics: {
        platform: 'windows',
        requirement: 'path_ownership_acl',
      },
    },
  );
}

export function assertCliCavePlatformSecurity(
  runtime: Pick<ResolvedCliRuntime, 'cave' | 'discoveryOptions' | 'platform'>,
): void {
  const error = missingCliCavePlatformSecurity(runtime);
  if (error !== undefined) {
    throw error;
  }
}
