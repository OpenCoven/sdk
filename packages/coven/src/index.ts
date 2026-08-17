export {
  CovenClient,
  CovenClientError,
  createCovenClient,
  normalizeCovenError,
} from './client.js';
export type { CovenClientOptions } from './client.js';
export { COVEN_DAEMON_PROTOCOL } from './schemas.js';
export type { CovenHealth, CovenHealthResponse } from './schemas.js';
export type { CovenTransport } from './transport.js';
