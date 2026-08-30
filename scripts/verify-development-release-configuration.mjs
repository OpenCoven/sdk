#!/usr/bin/env node

import {
  validateDevelopmentReleaseConfiguration,
} from './release-readiness.mjs';

function parseArguments(arguments_) {
  const options = {};

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== '--version') {
      throw new Error(`Unknown option ${argument}`);
    }
    if (options.version !== undefined) {
      throw new Error('Option --version may only be provided once');
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error('Option --version requires a value');
    }
    options.version = value;
    index += 1;
  }

  return options;
}

try {
  const result = validateDevelopmentReleaseConfiguration({
    root: process.cwd(),
    ...parseArguments(process.argv.slice(2)),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
