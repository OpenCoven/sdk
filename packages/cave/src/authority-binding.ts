import { createHash } from 'node:crypto';

import type { CaveDiscoveredEndpoint } from './discovery.js';
import type { CaveAuthorityBinding } from './schemas.js';
export {
  discardPairingExchangeBearer,
  parseCaveAuthorityBinding,
} from './authority-binding-contract.js';

function recordIdentity(path: string): string {
  return `sha256:${createHash('sha256').update(path, 'utf8').digest('hex')}`;
}

export function caveAuthorityBindingFromDiscoveredEndpoint(
  discovered: CaveDiscoveredEndpoint,
  instanceId: string,
): CaveAuthorityBinding {
  return {
    version: 1,
    instanceId,
    endpoint: {
      kind: 'http',
      url: discovered.endpoint.url,
    },
    record: {
      identity: recordIdentity(discovered.record.path),
      device: discovered.record.device,
      inode: discovered.record.inode,
    },
    freshness: {
      pid: discovered.freshness.pid,
      nonce: discovered.freshness.nonce,
      startedAt: discovered.freshness.startedAt,
    },
  };
}
