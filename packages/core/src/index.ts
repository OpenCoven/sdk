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
  createManagedMemorySecretStore,
  createMemorySecretStore,
  InvalidSecretKeyError,
  SecretStoreDisposedError,
} from './secret-store.js';
export type { ManagedSecretStore, SecretStore } from './secret-store.js';
