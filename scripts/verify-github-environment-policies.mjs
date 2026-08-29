#!/usr/bin/env node

import {
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  serializeReleaseEnvironmentPolicyReceipt,
  verifyLiveReleaseEnvironmentPolicies,
} from './github-environment-policy.mjs';
import {
  readReleaseConfig,
} from './release-readiness.mjs';

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== '--output') {
      throw new Error(`Unknown option ${argument}`);
    }
    if (options.output !== undefined) {
      throw new Error('Option --output may only be provided once');
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error('Option --output requires a value');
    }
    options.output = value;
    index += 1;
  }
  return options;
}

export function main(arguments_ = process.argv.slice(2)) {
  const options = parseArguments(arguments_);
  const config = readReleaseConfig(process.cwd());
  const receipt = verifyLiveReleaseEnvironmentPolicies({ config });
  const text = serializeReleaseEnvironmentPolicyReceipt(receipt);
  if (options.output !== undefined) {
    writeFileSync(options.output, text, { flag: 'wx', mode: 0o600 });
  } else {
    process.stdout.write(text);
  }
  return receipt;
}

if (
  process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
