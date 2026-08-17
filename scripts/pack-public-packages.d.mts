export function resolvePackArtifactOutputDirectory(artifactName?: string): string;
export function parseArgs(argv: string[]): {
  artifactName: string;
  build: boolean;
  jsonFile?: string;
  outputDir: string;
};
export function main(argv?: string[]): void;
