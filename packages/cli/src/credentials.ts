import { CAVE_PAIRING_SCOPES, type CaveCredentialBinding, type CavePairingRequest } from '@opencoven/cave-client';
import { createSecretStoreReference, type SecretStore, type SecretStoreReference } from '@opencoven/sdk-core';

export const NATIVE_SECRET_STORE_SERVICE = 'OpenCoven CLI';
export const CAVE_CREDENTIAL_REFERENCE_KEY = 'opencoven.cli.cave.credential';
export const DEFAULT_CAVE_PAIRING_REQUEST: CavePairingRequest = {
  appName: 'OpenCoven CLI',
  installationId: 'opencoven-cli',
  scopes: [...CAVE_PAIRING_SCOPES],
};

export function createCaveCredentialReference(
  createReference: typeof createSecretStoreReference = createSecretStoreReference,
): SecretStoreReference {
  return createReference(CAVE_CREDENTIAL_REFERENCE_KEY);
}

export function createCaveCredentialBinding(
  store: SecretStore,
  createReference: typeof createSecretStoreReference = createSecretStoreReference,
): CaveCredentialBinding {
  return {
    store,
    reference: createCaveCredentialReference(createReference),
  };
}
