import packageManifest from '../package.json' with { type: 'json' };

export const COVEN_CLIENT_VERSION = packageManifest.version;
