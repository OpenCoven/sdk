export function resolvePackArtifactOutputDirectory(
  artifactName?: string,
  options?: { repositoryRoot?: string },
): string;
export function preparePackArtifactOutputDirectory(
  artifactName?: string,
  options?: { repositoryRoot?: string },
): string;
export function removePackArtifactOutputDirectory(
  outputDirectory: string,
  options?: { repositoryRoot?: string },
): void;
export function parseArgs(argv: string[]): {
  artifactName: string;
  build: boolean;
  jsonFile?: string;
  outputDir: string;
};
export function main(argv?: string[]): void;
