#!/usr/bin/env node

import { validateReleaseReadiness } from './release-readiness.mjs';

function parseArguments(arguments_) {
  const options = {
    requireConformanceEvidence: true,
    requireLiveEnvironmentPolicy: true,
  };
  let conformanceEvidenceFlagSeen = false;
  let liveEnvironmentPolicyFlagSeen = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--require-conformance-evidence') {
      if (conformanceEvidenceFlagSeen) {
        throw new Error(
          'Option --require-conformance-evidence may only be provided once',
        );
      }
      conformanceEvidenceFlagSeen = true;
      continue;
    }
    if (argument === '--require-live-environment-policy') {
      if (liveEnvironmentPolicyFlagSeen) {
        throw new Error(
          'Option --require-live-environment-policy may only be provided once',
        );
      }
      liveEnvironmentPolicyFlagSeen = true;
      options.requireLiveEnvironmentPolicy = true;
      continue;
    }
    if (argument === '--require-tag') {
      if (options.requireTag !== undefined) {
        throw new Error('Option --require-tag may only be provided once');
      }
      options.requireTag = true;
      continue;
    }

    const optionNames = {
      '--mode': 'mode',
      '--version': 'version',
      '--tag': 'tag',
    };
    const optionName = optionNames[argument];
    if (optionName === undefined) {
      throw new Error(`Unknown option ${argument}`);
    }
    if (options[optionName] !== undefined) {
      throw new Error(`Option ${argument} may only be provided once`);
    }

    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Option ${argument} requires a value`);
    }
    options[optionName] = value;
    index += 1;
  }

  return options;
}

try {
  const result = validateReleaseReadiness({
    root: process.cwd(),
    ...parseArguments(process.argv.slice(2)),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
