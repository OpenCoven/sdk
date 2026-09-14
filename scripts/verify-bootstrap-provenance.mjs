#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serializeCanonicalJson } from './conformance-contract.mjs';
import { verifyPublicationSecurityReview } from './github-release-authorization.mjs';
import { verifyNpmProvenanceBundles } from './npm-bootstrap-provenance.mjs';
import { assertFrozenNodeRuntime, validateValidatorRuntimeFiles } from './release-readiness.mjs';

export function verifyBootstrapProvenance({
  root = process.cwd(),
  commentId,
  artifactRoot,
  attestationRoot,
  npmProvenanceRoot,
  execute = execFileSync,
  env = process.env,
} = {}) {
  for (const [name, value] of Object.entries({ commentId, artifactRoot, attestationRoot, npmProvenanceRoot })) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Manual bootstrap verification requires ${name}`);
    }
  }
  if (!/^[1-9]\d*$/u.test(commentId)) {
    throw new Error('Manual bootstrap verification requires the exact reviewed comment id');
  }
  assertFrozenNodeRuntime(root);
  const options = {
    root, commentId, artifactRoot, attestationRoot,
    allowedArtifactRoots: [npmProvenanceRoot],
    execute, env,
  };
  const { authorization } = verifyPublicationSecurityReview(options);
  validateValidatorRuntimeFiles(root, authorization.source.commit, authorization.source.commit);
  const verified = verifyNpmProvenanceBundles({
    authorization, artifactRoot, npmProvenanceRoot, execute, env,
  });
  // Recheck live SHIP/source/tag/policy and all six original subjects before
  // reporting. Bootstrap approval remains a separate human gate, not this CLI.
  const current = verifyPublicationSecurityReview(options);
  validateValidatorRuntimeFiles(root, authorization.source.commit, authorization.source.commit);
  if (serializeCanonicalJson(current.authorization) !== serializeCanonicalJson(authorization)) {
    throw new Error('Publication authorization changed during manual bootstrap verification');
  }
  const result = {
    kind: 'opencoven-sdk-bootstrap-provenance-verification',
    commentId,
    version: authorization.version,
    source: { commit: authorization.source.commit, tree: authorization.source.tree },
    sourceRef: authorization.provenance.sourceRef,
    runId: authorization.provenance.runId,
    runAttempt: authorization.provenance.runAttempt,
    trust: 'sigstore-public-good-only',
    npmProvenance: verified.entries,
    bootstrapApproval: 'separate-human-gate-required',
  };
  verified.assertUnchanged();
  return result;
}

export function main(arguments_ = process.argv.slice(2)) {
  const names = {
    '--comment-id': 'commentId',
    '--artifact-root': 'artifactRoot',
    '--attestation-root': 'attestationRoot',
    '--npm-provenance-root': 'npmProvenanceRoot',
  };
  const options = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const argument = arguments_[index];
    if (!Object.hasOwn(names, argument)) {
      throw new Error(`Unknown option ${argument}`);
    }
    const name = names[argument];
    if (Object.hasOwn(options, name)) {
      throw new Error(`Option ${argument} may only be provided once`);
    }
    const value = arguments_[index + 1];
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
      throw new Error(`Option ${argument} requires a value`);
    }
    options[name] = value;
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = verifyBootstrapProvenance({ root, ...options });
  process.stdout.write(serializeCanonicalJson(result));
  return result;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
