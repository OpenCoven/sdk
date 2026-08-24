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
} from './client.js';
export type {
  CaveDiscoveryDependencies,
  CaveDiscoveryErrorCode,
  CaveDiscoveryFileHandle,
  CaveDiscoveryPathIdentity,
  CaveDiscoveryRecordIdentity,
  CaveDiscoveredEndpoint,
  CaveEndpointFreshness,
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
  CaveExecutionSlice,
  CaveExecutionWindow,
  CaveFamiliar,
  CaveFamiliarAnalytics,
  CaveFamiliarAnalyticsResponse,
  CaveFamiliarContract,
  CaveFamiliarContractResponse,
  CaveFamiliarProperty,
  CaveFamiliarsResponse,
  CaveFamiliarWire,
  CaveHealth,
  CaveHealthData,
  CaveHealthResponse,
  CavePairingCreated,
  CavePairingExchange,
  CavePairingRequest,
  CavePairingScope,
  CavePairingState,
  CavePairingStatus,
  CavePropertyCoverage,
} from './schemas.js';
export type {
  CaveCredentialPersistingTransport,
  CaveTransport,
} from './transport.js';
export { CAVE_CLIENT_VERSION } from './version.js';
