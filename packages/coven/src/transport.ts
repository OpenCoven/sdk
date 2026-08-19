import type { OperationContext } from '@opencoven/sdk-core';

import type { CovenHealthResponse } from './schemas.js';

export interface CovenTransport {
  health(context?: OperationContext): Promise<CovenHealthResponse>;
}
