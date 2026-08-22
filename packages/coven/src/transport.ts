import type { OperationContext } from '@opencoven/sdk-core';

import type { CovenHealthResponse } from './schemas.js';
import type { CovenUnixTransportSecurityProvider } from './transport-unix.js';
import type { CovenWindowsTransportSecurityProvider } from './transport-windows.js';

export interface CovenTransport {
  health(context?: OperationContext): Promise<CovenHealthResponse>;
}

export type CovenTransportSecurityProvider =
  | CovenUnixTransportSecurityProvider
  | CovenWindowsTransportSecurityProvider;
