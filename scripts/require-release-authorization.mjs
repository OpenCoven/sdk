if (process.env.OPENCOVEN_RELEASE_AUTHORIZATION !== 'publish') {
  console.error(
    'Publishing is disabled until release approval. Set OPENCOVEN_RELEASE_AUTHORIZATION=publish as part of the release process.',
  );
  process.exit(1);
}
