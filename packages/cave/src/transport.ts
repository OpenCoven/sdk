import type { CaveHealthResponse } from './schemas.js';

export interface CaveTransport {
  health(): Promise<CaveHealthResponse>;
}
