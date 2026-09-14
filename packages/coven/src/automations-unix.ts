import type { CovenAutomationsTransport } from './automations.js';
import { createCovenAutomationsSocketTransport } from './automations-socket.js';
import { CovenClientError, normalizeCovenError } from './client-errors.js';
import type { CovenDiscoveredEndpoint } from './discovery.js';
import {
  createCovenUnixSocketAccess,
  type CovenUnixTransportDependencies,
  type CovenUnixTransportSecurityProvider,
} from './transport-unix.js';

export interface CovenAutomationsUnixTransportOptions {
  readonly security: CovenUnixTransportSecurityProvider;
  readonly dependencies?: CovenUnixTransportDependencies;
}

/** Uses the same endpoint and connected-peer checks as the Unix health transport. */
export function createCovenAutomationsUnixTransport(
  discovered: CovenDiscoveredEndpoint,
  options: CovenAutomationsUnixTransportOptions,
): CovenAutomationsTransport {
  if (process.platform === 'win32') {
    throw new CovenClientError(normalizeCovenError({ code: 'unsupported_platform' }, 'automations.capabilities'));
  }
  return createCovenAutomationsSocketTransport(createCovenUnixSocketAccess(discovered, options));
}
