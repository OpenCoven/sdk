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
  CovenDiscoveredUnixClientOptions,
  CovenDiscoveredUnixTransportOptions,
  CovenDiscoveredWindowsClientOptions,
  CovenDiscoveredWindowsTransportOptions,
} from './client.js';
export {
  CovenIpcError,
  discoverCovenEndpoint,
  isCovenIpcError,
} from './discovery.js';
export type {
  CovenDiscoveredEndpoint,
  CovenDiscoveryFileIdentity,
  CovenDiscoveryDependencies,
  CovenDiscoverySource,
  CovenEndpointFreshness,
  CovenEndpointOwner,
  CovenExecutableResolver,
  CovenExecFile,
  CovenExecFileError,
  CovenExecFileOptions,
  CovenIpcDiagnostics,
  CovenIpcErrorCode,
  CovenMetadataFileHandle,
  CovenWindowsFileTrustValidator,
  DiscoverCovenEndpointOptions,
} from './discovery.js';
export { COVEN_DAEMON_PROTOCOL } from './schemas.js';
export type { CovenHealth, CovenHealthResponse } from './schemas.js';
export type {
  CovenTransport,
  CovenTransportSecurityProvider,
} from './transport.js';
export {
  CovenDaemonResponseError,
  createCovenUnixTransport,
  isCovenDaemonResponseError,
} from './transport-unix.js';
export type {
  CovenDaemonFailure,
  CovenConnectedSocket,
  CovenHealthTransportLimits,
  CovenSocket,
  CovenSocketConnector,
  CovenUnixFileIdentity,
  CovenUnixPeerIdentity,
  CovenUnixPeerIdentityAdapter,
  CovenUnixTransportDependencies,
  CovenUnixTransportOptions,
  CovenUnixTransportSecurityProvider,
} from './transport-unix.js';
export { createCovenWindowsTransport } from './transport-windows.js';
export type {
  CovenWindowsPipeIdentity,
  CovenWindowsPipeOwnershipAdapter,
  CovenWindowsTransportDependencies,
  CovenWindowsTransportOptions,
  CovenWindowsTransportSecurityProvider,
} from './transport-windows.js';
