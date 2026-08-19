import type { OperationContext } from '@opencoven/sdk-core';

import type { CaveHealthResponse } from './schemas.js';

export interface CaveTransport {
  health(context?: OperationContext): Promise<CaveHealthResponse>;
}
