export {
  OpenCovenSdk,
  OpenCovenSdkError,
  createOpenCovenSdk,
} from './client.js';
export type {
  ClientHealthResult,
  ClientAvailability,
  OpenCovenHealth,
  OpenCovenHealthOptions,
  OpenCovenHealthReport,
  OpenCovenSdkOptions,
} from './client.js';
export {
  collectOpenCovenDiagnostics,
  describeSdkCapabilities,
} from './diagnostics.js';
export type { OpenCovenDiagnosticsOptions } from './diagnostics.js';
export { OPENCOVEN_SDK_VERSION } from './version.js';

/**
 * Diagnostics types are re-exported so a consumer can annotate a bundle without
 * also depending on `@opencoven/sdk-core` directly.
 */
export type {
  DiagnosticsBundle,
  DiagnosticsCapabilities,
  DiagnosticsEndpoint,
  DiagnosticsEndpointInput,
  DiagnosticsError,
  DiagnosticsOperationSummary,
  DiagnosticsRuntime,
  DiagnosticsVersions,
} from '@opencoven/sdk-core';
