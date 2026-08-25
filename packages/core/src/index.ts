export { normalizeError } from './errors.js';
export type {
  NormalizedError,
  NormalizeErrorOptions,
  OpenCovenSystem,
} from './errors.js';

export {
  createOpenCovenDiagnosticReport,
  OPENCOVEN_DIAGNOSTIC_VERSION,
  OpenCovenDiagnosticError,
} from './diagnostics.js';
export type {
  OpenCovenDiagnosticCheck,
  OpenCovenDiagnosticCheckId,
  OpenCovenDiagnosticCheckInput,
  OpenCovenDiagnosticCapability,
  OpenCovenDiagnosticCode,
  OpenCovenDiagnosticEnvironment,
  OpenCovenDiagnosticFailure,
  OpenCovenDiagnosticFacts,
  OpenCovenDiagnosticOperation,
  OpenCovenDiagnosticPhase,
  OpenCovenDiagnosticReport,
  OpenCovenDiagnosticReportOptions,
  OpenCovenDiagnosticRuntimeInput,
  OpenCovenDiagnosticSkipReason,
  OpenCovenDiagnosticStatus,
  OpenCovenDiagnosticSummary,
  OpenCovenDiagnosticSystem,
} from './diagnostics.js';

export { assessCompatibility } from './compatibility.js';
export type { CompatibilityAssessment } from './compatibility.js';

export {
  createOperationScope,
  isOperationAbortedError,
  isOperationTimeoutError,
  OperationAbortedError,
  OperationConfigurationError,
  OperationTimeoutError,
  runOperation,
} from './operation-control.js';
export type {
  OperationContext,
  OperationDefaults,
  OperationDescriptor,
  OperationOptions,
  OperationScope,
  OperationScopeOptions,
} from './operation-control.js';
export type { OperationEvent, OperationObserver } from './operation-events.js';

export { iteratePages, normalizePageOptions } from './pagination.js';
export type {
  BoundedPageOptions,
  Page,
  PageCursor,
  PageOptions,
} from './pagination.js';

export {
  DISCOVERY_PROFILES,
  DISCOVERY_PROTOCOL,
  DISCOVERY_RECORD_VERSION,
  DiscoveryContractError,
  parseDiscoveryEndpoint,
  parseDiscoveryRecord,
} from './discovery.js';
export type {
  DiscoveryDiagnosticCode,
  DiscoveryEndpoint,
  DiscoveryProfile,
  DiscoveryRecord,
} from './discovery.js';

export {
  createManagedMemorySecretStore,
  createMemorySecretStore,
  createSecretStoreReference,
  InvalidSecretKeyError,
  SecretStoreDisposedError,
} from './secret-store.js';
export type {
  ManagedSecretStore,
  SecretStore,
  SecretStoreReference,
} from './secret-store.js';

export {
  createFileOpenCovenProfileStore,
  createMemoryOpenCovenProfileStore,
  createOpenCovenProfileSecretReference,
  migrateOpenCovenProfileDocument,
  OPENCOVEN_PROFILE_VERSION,
  OpenCovenProfileError,
  parseOpenCovenProfile,
} from './profiles.js';
export type {
  FileOpenCovenProfileStoreOptions,
  OpenCovenProfile,
  OpenCovenProfileDocument,
  OpenCovenProfileErrorCode,
  OpenCovenProfileStore,
} from './profiles.js';
