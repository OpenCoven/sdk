export interface CompatibilityAssessment {
  compatible: boolean;
  minimumClientVersion: string;
  clientVersion: string;
}

interface ParsedSemver {
  major: string;
  minor: string;
  patch: string;
  prerelease: string[];
}

interface ComparisonIdentifier {
  numeric: boolean;
  value: string;
}

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function isNumericIdentifier(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const character = value.charCodeAt(index);

    if (character < 48 || character > 57) {
      return false;
    }
  }

  return true;
}

function hasInvalidNumericLeadingZero(value: string): boolean {
  return value.length > 1 && value.charCodeAt(0) === 48;
}

function parseSemver(version: string): ParsedSemver | undefined {
  const match = SEMVER_PATTERN.exec(version);

  if (match === null) {
    return undefined;
  }

  const prerelease = match[4]?.split('.') ?? [];
  const [major, minor, patch] = [match[1], match[2], match[3]];

  if (major === undefined || minor === undefined || patch === undefined) {
    return undefined;
  }

  if (
    prerelease.some(
      (identifier) => isNumericIdentifier(identifier) && hasInvalidNumericLeadingZero(identifier),
    )
  ) {
    return undefined;
  }

  return {
    major,
    minor,
    patch,
    prerelease,
  };
}

function asComparisonIdentifier(value: string): ComparisonIdentifier {
  return isNumericIdentifier(value)
    ? {
        numeric: true,
        value,
      }
    : {
        numeric: false,
        value,
      };
}

function normalizeNumericIdentifier(value: string): string {
  let start = 0;

  while (start < value.length - 1 && value.charCodeAt(start) === 48) {
    start += 1;
  }

  return value.slice(start);
}

function compareLexical(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function compareNumericIdentifiers(left: string, right: string): number {
  const normalizedLeft = normalizeNumericIdentifier(left);
  const normalizedRight = normalizeNumericIdentifier(right);

  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length - normalizedRight.length;
  }

  return compareLexical(normalizedLeft, normalizedRight);
}

function compareIdentifiers(left: string, right: string): number {
  const leftIdentifier = asComparisonIdentifier(left);
  const rightIdentifier = asComparisonIdentifier(right);

  if (leftIdentifier.numeric && rightIdentifier.numeric) {
    return compareNumericIdentifiers(leftIdentifier.value, rightIdentifier.value);
  }

  if (leftIdentifier.numeric !== rightIdentifier.numeric) {
    return leftIdentifier.numeric ? -1 : 1;
  }

  return compareLexical(leftIdentifier.value, rightIdentifier.value);
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }

  if (left.length === 0) {
    return 1;
  }

  if (right.length === 0) {
    return -1;
  }

  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];

    if (leftIdentifier === undefined) {
      return -1;
    }

    if (rightIdentifier === undefined) {
      return 1;
    }

    const comparison = compareIdentifiers(leftIdentifier, rightIdentifier);

    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

function compareParsedSemver(left: ParsedSemver, right: ParsedSemver): number {
  const majorComparison = compareNumericIdentifiers(left.major, right.major);

  if (majorComparison !== 0) {
    return majorComparison;
  }

  const minorComparison = compareNumericIdentifiers(left.minor, right.minor);

  if (minorComparison !== 0) {
    return minorComparison;
  }

  const patchComparison = compareNumericIdentifiers(left.patch, right.patch);

  if (patchComparison !== 0) {
    return patchComparison;
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

function requireSemver(version: string, label: string): ParsedSemver {
  const parsed = parseSemver(version);

  if (parsed === undefined) {
    throw new Error(`Invalid ${label} semver: ${version}`);
  }

  return parsed;
}

export function assessCompatibility(
  minimumClientVersion: string,
  clientVersion: string,
): CompatibilityAssessment {
  const minimum = requireSemver(minimumClientVersion, 'minimum client version');
  const client = requireSemver(clientVersion, 'client version');

  return {
    compatible: compareParsedSemver(client, minimum) >= 0,
    minimumClientVersion,
    clientVersion,
  };
}
