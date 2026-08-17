import type { OwnedTempDirectoryContext } from './owned-temp-directory.mjs';

export function createPackArtifactOutputDirectory(): OwnedTempDirectoryContext;
export function parseArgs(argv: string[]): {
  build: boolean;
  jsonFile: string | undefined;
};
export function main(argv?: string[]): void;
