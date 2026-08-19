import packageManifest from '../package.json' with { type: 'json' };

export const CAVE_CLIENT_VERSION = packageManifest.version;
