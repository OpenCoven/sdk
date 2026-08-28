import { createHash } from 'node:crypto';

import {
  CAVE_HPKE_KEY_ID_DOMAIN,
  parseCaveDiscoveryRecordCandidate,
  verifyCaveDiscoveryRecordCandidate,
  type CaveParsedDiscoveryRecord,
} from './discovery-record.js';

export * from './discovery-record.js';

export function parseCaveDiscoveryRecord(
  serialized: string,
  isProcessAlive: (pid: number) => boolean,
): CaveParsedDiscoveryRecord {
  const candidate = parseCaveDiscoveryRecordCandidate(
    serialized,
    isProcessAlive,
  );
  const computedKeyId =
    candidate.authorityKey === undefined
      ? undefined
      : new Uint8Array(
          createHash('sha256')
            .update(CAVE_HPKE_KEY_ID_DOMAIN, 'utf8')
            .update(candidate.authorityKey.publicKey)
            .digest(),
        );
  return verifyCaveDiscoveryRecordCandidate(candidate, computedKeyId);
}
