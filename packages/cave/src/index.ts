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
export {
  CAVE_CONVERSATION_EVENT_TYPES,
  CAVE_CONVERSATION_OPERATION_STATES,
  CAVE_CONVERSATION_ORIGINATING_SCOPES,
  CAVE_CONVERSATION_RECONCILE_REASONS,
  CAVE_CONVERSATION_TERMINAL_STATES,
  caveConversationReconcileReason,
  createConversationEventTranslator,
  validateConversationEventCursor,
} from './conversation-control.js';
export {
  CAVE_ATTACHMENT_CONTENT_TYPES,
  CAVE_ATTACHMENT_LIMITS,
  sniffCaveAttachmentContentType,
  bindCaveAttachments,
  parseCaveAttachmentDownloadRequest,
  parseCaveAttachmentRecord,
  parseCaveAttachmentUploadRequest,
  CaveAttachmentSchemaError,
} from './attachment-transfer.js';
export {
  CAVE_PRIVILEGED_ACTION_CLASSES,
  CAVE_PRIVILEGED_ACTION_REQUIREMENTS,
  CAVE_DEFAULT_CAPABILITY_CONTRACT,
  createCaveCapabilityRegistry,
  createDefaultCaveCapabilityRegistry,
  parsePrivilegedConfirmation,
  validatePrivilegedOperationId,
} from './privileged-capabilities.js';
export {
  CAVE_RICH_CONTENT_LIMITS,
  CAVE_RICH_CONTENT_URL_SCHEMES,
  parseCaveRichContent,
  serializeCaveRichContent,
  collectCaveRichContentUrls,
  parseCaveRichContentUrl,
  CaveRichContentError,
} from './rich-content.js';
export {
  CAVE_TASK_HANDOFF_STATES,
  CAVE_TASK_HANDOFF_TRANSITIONS,
  CAVE_ATTENTION_RESPONSE_KINDS,
  isCaveTaskHandoffTransition,
  parseCaveTaskHandoffRequest,
  parseCaveAttentionResponseRequest,
} from './attention-handoff.js';
export {
  CAVE_GITHUB_ACTION_KINDS,
  parseCaveGitHubActionRequest,
} from './github-actions.js';
export type {
  CaveConversationEvent,
  CaveConversationEventBase,
  CaveConversationEventPage,
  CaveConversationEventPageRequest,
  CaveConversationEventTranslator,
  CaveConversationEventType,
  CaveConversationOperation,
  CaveConversationOperationId,
  CaveConversationOperationKind,
  CaveConversationOperationState,
  CaveConversationOriginatingScope,
  CaveConversationReconcileReason,
  CaveConversationStreamOptions,
  CaveConversationTranslatedPage,
  CaveCreateConversationRequest,
  CaveCreateConversationResult,
  CaveRetryConversationTurnRequest,
  CaveSendConversationMessageRequest,
  CaveSendConversationMessageResult,
} from './conversation-control.js';
export type {
  CaveAttachmentBinding,
  CaveAttachmentContent,
  CaveAttachmentDescriptor,
  CaveAttachmentDownloadRequest,
  CaveAttachmentRecord,
  CaveAttachmentUploadRequest,
  CaveAttachmentContentType,
} from './attachment-transfer.js';
export type {
  CaveCapabilityRegistry,
  CaveCapabilityResolution,
  CaveCapabilityStatus,
  CaveCapabilityContractSource,
  CaveDeclaredOperationRef,
  CavePrivilegedActionClass,
  CavePrivilegedActionRequirement,
} from './privileged-capabilities.js';
export type {
  CaveRichContentDocument,
  CaveRichContentBlock,
  CaveRichContentInline,
  CaveRichContentUrlScheme,
} from './rich-content.js';
export type {
  CaveTaskHandoffState,
  CaveTaskHandoffRequest,
  CaveAttentionResponseKind,
  CaveAttentionResponseRequest,
} from './attention-handoff.js';
export type {
  CaveGitHubActionKind,
  CaveGitHubActionRequest,
} from './github-actions.js';
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
  CaveTransport,
} from './transport.js';
export { CAVE_CLIENT_VERSION } from './version.js';
