import type { CovenAutomationsTransport } from './automations.js';
import { createCovenAutomationsSocketTransport } from './automations-socket.js';
import type { CovenDiscoveredEndpoint } from './discovery.js';
import {
  createCovenWindowsSocketAccess,
  type CovenWindowsTransportDependencies,
  type CovenWindowsTransportSecurityProvider,
} from './transport-windows.js';

export interface CovenAutomationsWindowsTransportOptions {
  readonly security: CovenWindowsTransportSecurityProvider;
  readonly dependencies?: CovenWindowsTransportDependencies;
}

/** Requires the same owner-only ACL and connected-pipe identity checks as health. */
export function createCovenAutomationsWindowsTransport(
  discovered: CovenDiscoveredEndpoint,
  options: CovenAutomationsWindowsTransportOptions,
): CovenAutomationsTransport {
  return createCovenAutomationsSocketTransport(createCovenWindowsSocketAccess(discovered, options));
}
