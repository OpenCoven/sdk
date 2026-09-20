export { CovenAutomationsClient, createCovenAutomationsClient } from './automations.js';
export type {
  CovenAutomationEvent,
  CovenAutomationEventPage,
  CovenAutomationEventStream,
  CovenAutomationEventsOptions,
  CovenAutomationEventsRequest,
} from './automations-events.js';
export type {
  CovenAutomationCapabilities,
  CovenAutomationCapabilityProfile,
  CovenAutomationVariant,
  CovenAutomationsClientOptions,
  CovenAutomationsTransport,
} from './automations.js';
export { createCovenAutomationsUnixTransport } from './automations-unix.js';
export type { CovenAutomationsUnixTransportOptions } from './automations-unix.js';
export { createCovenAutomationsWindowsTransport } from './automations-windows.js';
export type { CovenAutomationsWindowsTransportOptions } from './automations-windows.js';
export type {
  CovenAutomationReceipt,
  CovenAutomationReceiptDigest,
  CovenAutomationReceiptReadVerification,
  CovenAutomationReceiptResult,
} from './automations-receipts.js';
export type {
  CovenAutomationOccurrence,
  CovenAutomationOccurrenceDetail,
  CovenAutomationOccurrenceResult,
  CovenAutomationOccurrenceRun,
  CovenAutomationOccurrencesOptions,
  CovenAutomationOccurrencesResult,
  CovenAutomationOccurrenceView,
} from './automations-occurrences.js';
export type {
  CovenAutomationAttempt,
  CovenAutomationRun,
  CovenAutomationRunCancellation,
  CovenAutomationRunsOptions,
  CovenAutomationRunsResult,
} from './automations-runs.js';
export type {
  CovenAutomationDefinition,
  CovenAutomationDefinitionList,
  CovenAutomationDefinitionReadRequest,
  CovenAutomationHealth,
  CovenAutomationHealthResult,
  CovenAutomationListOptions,
  CovenAutomationRoutine,
} from './automations-definitions.js';
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
export {
  COVEN_SESSION_POLICY_CONTRACT,
  COVEN_SESSION_POLICY_PROFILE,
  CovenSessionPolicyClient,
  CovenSessionPolicyError,
  createCovenSessionPolicyClient,
  isCovenSessionPolicyError,
} from './session-policy.js';
export { createCovenSessionPolicyUnixTransport } from './session-policy-unix.js';
export type { CovenSessionPolicyUnixTransportOptions } from './session-policy-unix.js';
export type {
  CovenRestrictedLaunchRequest,
  CovenSessionPolicyClientOptions,
  CovenSessionPolicyDelivery,
  CovenSessionPolicyDiscovery,
  CovenSessionPolicyErrorCode,
  CovenSessionPolicyRefusal,
  CovenSessionPolicyTransport,
  CovenSessionPolicyTransportRequest,
  CovenSessionPolicyTransportResponse,
} from './session-policy.js';
