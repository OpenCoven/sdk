import type { CovenHealthResponse } from './schemas.js';

export interface CovenTransport {
  health(): Promise<CovenHealthResponse>;
}
