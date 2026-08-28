export interface VerifyCaveContractAuthorityOptions {
  caveRoot: string;
  expectedCommit?: string;
  sourceCommit?: string;
  resolveCommit?: (caveRoot: string) => string;
  readCommitFile?: (
    caveRoot: string,
    commit: string,
    path: string,
  ) => Buffer;
}

export interface VerifiedCaveContractAuthority {
  commit: string;
  checkoutCommit: string;
  sha256: string;
  vectorSha256: string;
}

export function parseCaveContractAuthorityArguments(argv: string[]): {
  caveRoot: string;
  sourceCommit: string | undefined;
};

export function verifyCaveContractAuthority(
  options: VerifyCaveContractAuthorityOptions,
): VerifiedCaveContractAuthority;
