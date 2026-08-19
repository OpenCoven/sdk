import type { OperationContext } from '@opencoven/sdk-core';

import type {
  CaveFamiliarAnalyticsResponse,
  CaveFamiliarContractResponse,
  CaveFamiliarsResponse,
  CaveHealthResponse,
} from './schemas.js';

export interface CaveTransport {
  health(context?: OperationContext): Promise<CaveHealthResponse>;
  /**
   * The familiar operations are optional so that a transport written against
   * an older Cave still satisfies this interface. The client reports a missing
   * one as `unsupported_operation` rather than crashing on `undefined`.
   */
  familiars?(context?: OperationContext): Promise<CaveFamiliarsResponse>;
  familiarContract?(
    familiarId: string,
    context?: OperationContext,
  ): Promise<CaveFamiliarContractResponse>;
  familiarAnalytics?(
    familiarId: string,
    options?: { recentLimit?: number },
    context?: OperationContext,
  ): Promise<CaveFamiliarAnalyticsResponse>;
}
