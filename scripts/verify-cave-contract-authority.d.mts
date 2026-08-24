export interface VerifyCaveContractAuthorityOptions {
  caveRoot: string;
  expectedCommit?: string;
  resolveCommit?: (caveRoot: string) => string;
}

export interface VerifiedCaveContractAuthority {
  commit: string;
  sha256: string;
}

export function parseCaveContractAuthorityArguments(argv: string[]): {
  caveRoot: string;
};

export function verifyCaveContractAuthority(
  options: VerifyCaveContractAuthorityOptions,
): VerifiedCaveContractAuthority;
