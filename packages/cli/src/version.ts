import packageManifest from '../package.json' with { type: 'json' };

export const DEV_CLI_VERSION = packageManifest.version;
