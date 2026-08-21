export {
  CovenClient,
  CovenClientError,
  createCovenClient,
  isCovenClientError,
  normalizeCovenError,
} from './client.js';
export type { CovenCapabilities, CovenClientOptions } from './client.js';
export { COVEN_DAEMON_PROTOCOL } from './schemas.js';
export type { CovenHealth, CovenHealthResponse } from './schemas.js';
export type { CovenTransport } from './transport.js';
export { COVEN_CLIENT_VERSION } from './version.js';
