export { normalizeError } from './errors.js';
export type {
  NormalizedError,
  NormalizeErrorOptions,
  OpenCovenSystem,
} from './errors.js';

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
