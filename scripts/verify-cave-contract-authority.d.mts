export interface VerifyCaveContractAuthorityOptions {
  caveRoot: string;
  expectedCommit?: string;
  allowEquivalentHead?: boolean;
  resolveCommit?: (caveRoot: string) => string;
  isEquivalentCommit?: (
    caveRoot: string,
    pinnedCommit: string,
    actualCommit: string,
    provenance: Record<string, string>,
  ) => boolean;
}

export interface VerifiedCaveContractAuthority {
  commit: string;
  checkoutCommit: string;
  sha256: string;
  vectorSha256: string;
}

export function parseCaveContractAuthorityArguments(argv: string[]): {
  caveRoot: string;
  allowEquivalentHead: boolean;
};

export function verifyCaveContractAuthority(
  options: VerifyCaveContractAuthorityOptions,
): VerifiedCaveContractAuthority;
