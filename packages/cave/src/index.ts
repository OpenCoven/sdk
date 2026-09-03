export {
  CaveClient,
  CaveClientError,
  CavePairingSession,
  createCaveClient,
  isCaveClientError,
  normalizeCaveError,
} from './client.js';
export {
  CaveDiscoveryError,
  discoverCaveEndpoint,
  isCaveDiscoveryError,
} from './discovery.js';
export {
  createManagedCaveClient,
  type CaveManagedClientOptions,
  type CaveManagedNativeDiscardResult,
  type CaveManagedNativePairingCreated,
  type CaveManagedNativePairingExchange,
  type CaveManagedNativeResponse,
  type CaveManagedNativeTransport,
} from './managed-native.js';
export {
  createDiscoveredCaveClient,
} from './pairing.js';
export {
  digestCaveContractFixture,
  parseCaveContractFixture,
  parseVerifiedCaveContractFixture,
  verifyCaveContractFixtureDigest,
} from './contract-fixture.js';
export type {
  CaveClientOptions,
  CaveCredentialBinding,
  CaveFamiliarAnalyticsOptions,
  CaveManagedNativeCredentialCustody,
} from './client.js';
export type {
  CaveDiscoveryDependencies,
  CaveDiscoveryErrorCode,
  CaveDiscoveryFileHandle,
  CaveDiscoveryPathIdentity,
  CaveDiscoveryRecordIdentity,
  CaveDiscoveredEndpoint,
  CaveEndpointFreshness,
  CaveWindowsPathTrustResult,
  CaveWindowsPathTrustValidator,
  DiscoverCaveEndpointOptions,
} from './discovery.js';
export type { CaveDiscoveredClientOptions } from './pairing.js';
export type {
  CaveContractCursor,
  CaveContractEnvelopeMetadata,
  CaveContractFixture,
  CaveContractHealthData,
  CaveContractIdentity,
  CaveContractOperation,
  CaveContractPairingCreatedData,
  CaveContractPairingExchangeData,
  CaveContractPairingStatusData,
  CaveContractPublicRoute,
  CaveContractRevision,
} from './contract-fixture.js';
export {
  CAVE_ANALYTICS_WINDOWS,
  CAVE_FAMILIAR_PROPERTIES,
  CAVE_PAIRING_SCOPES,
  CAVE_PAIRING_STATUSES,
} from './schemas.js';
export type {
  CaveAuthorityBinding,
  CaveAuthorityBoundPairingExchange,
  CaveAnalyticsWindowKey,
  CaveCanonicalFamiliar,
  CaveConversation,
  CaveConversationMessage,
  CaveContractFile,
  CaveContractReport,
  CaveContractViolation,
  CaveCredentialAccess,
  CaveCredentialDisconnectedReason,
  CaveCredentialMetadata,
  CaveCredentialStatus,
  CaveExecutionAttempt,
  CaveExecutionBackfill,
  CaveExecutionCoverage,
  CaveExecutionDay,
  CaveExecutionSlice,
  CaveExecutionWindow,
  CaveFamiliar,
  CaveFamiliarAnalytics,
  CaveFamiliarAnalyticsResponse,
  CaveFamiliarContract,
  CaveFamiliarContractPresence,
  CaveFamiliarContractResponse,
  CaveFamiliarIdentity,
  CaveFamiliarWard,
  CaveFamiliarProperty,
  CaveFamiliarsResponse,
  CaveFamiliarWire,
  CaveHealth,
  CaveHealthData,
  CaveHealthResponse,
  CavePairingCreated,
  CaveManagedCredentialStatusResult,
  CaveManagedForgetCredentialResult,
  CaveManagedPairingCreated,
  CaveManagedPairingExchange,
  CavePairingExchange,
  CavePairingRequest,
  CavePairingScope,
  CavePairingState,
  CavePairingStatus,
  CaveProject,
  CavePropertyCoverage,
} from './schemas.js';
export type {
  CaveCredentialPersistingTransport,
  CaveManagedCredentialTransport,
  CaveFamiliarAnalyticsTransportOptions,
  CaveTransport,
} from './transport.js';
export { CAVE_CLIENT_VERSION } from './version.js';
