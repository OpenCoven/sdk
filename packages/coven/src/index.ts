export {
  CovenClient,
  CovenClientError,
  createCovenClient,
  createDiscoveredCovenClient,
  isCovenClientError,
  normalizeCovenError,
} from './client.js';
export type {
  CovenClientOptions,
  CovenDiscoveredClientOptions,
} from './client.js';
export {
  CovenIpcError,
  discoverCovenEndpoint,
  isCovenIpcError,
} from './discovery.js';
export type {
  CovenDiscoveredEndpoint,
  CovenDiscoveryDependencies,
  CovenDiscoverySource,
  CovenEndpointFreshness,
  CovenEndpointOwner,
  CovenExecFile,
  CovenExecFileError,
  CovenExecFileOptions,
  CovenIpcDiagnostics,
  CovenIpcErrorCode,
  DiscoverCovenEndpointOptions,
} from './discovery.js';
export { COVEN_DAEMON_PROTOCOL } from './schemas.js';
export type { CovenHealth, CovenHealthResponse } from './schemas.js';
export type { CovenTransport } from './transport.js';
export {
  CovenDaemonResponseError,
  createCovenUnixTransport,
  isCovenDaemonResponseError,
} from './transport-unix.js';
export type {
  CovenDaemonFailure,
  CovenHealthTransportLimits,
  CovenSocket,
  CovenSocketConnector,
  CovenUnixFileIdentity,
  CovenUnixPeerIdentity,
  CovenUnixPeerIdentityAdapter,
  CovenUnixTransportDependencies,
  CovenUnixTransportOptions,
} from './transport-unix.js';
export { createCovenWindowsTransport } from './transport-windows.js';
export type {
  CovenWindowsPipeIdentity,
  CovenWindowsPipeOwnershipAdapter,
  CovenWindowsTransportDependencies,
  CovenWindowsTransportOptions,
} from './transport-windows.js';
