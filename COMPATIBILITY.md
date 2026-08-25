# Compatibility and deprecation policy

## Supported public surface

The supported SDK surface is the root export of each publishable package:

- `@opencoven/sdk-core`
- `@opencoven/cave-client`
- `@opencoven/coven-client`
- `@opencoven/sdk`

Only each package root and its exported `package.json` subpath are supported.
Source files, build directories, private CLI modules, repository scripts, and
all other package subpaths are implementation details rather than public API.
The supported runtime and maintenance window are defined in
[SUPPORT.md](SUPPORT.md).

## Version compatibility

Before 1.0, OpenCoven follows SemVer precedence while reserving minor releases
for intentional breaking changes. Patch releases must remain compatible with
the current minor release. Consumers should pin an explicit compatible range
and upgrade to the latest supported minor before requesting fixes.

Cave Client v1 compatibility remains producer-declared and additive within the
supported API major version. The SDK rejects malformed required fields,
unsupported protocol majors, and minimum-client requirements newer than the
installed client. Unknown additive fields do not become SDK API unless they are
documented, typed, and added to the reviewed baseline.

## Deprecation

An API planned for removal is documented as deprecated, receives a Changeset,
and remains available for at least one subsequent minor release when security
and protocol correctness permit. Removal requires an intentional baseline
change and a migration note. Unsafe behavior may be removed without the normal
window when retaining it would expose credentials, weaken authority validation,
or violate an upstream protocol contract.

## Packed API baselines

The `api-baselines/` directory freezes the packed `dist/index.d.ts`, runtime
export names, and package export map for every publishable package.
`verify:package` builds tarballs, extracts them into an isolated package tree,
loads their runtime exports, and compares all three surfaces to the committed
baseline. Accidental signature, export, or export-map drift fails CI.

After an intentional reviewed API change, regenerate the baselines:

```bash
corepack pnpm@10.34.0 api:baseline:update
git diff -- api-baselines
corepack pnpm@10.34.0 verify:package
```

Baseline changes must accompany the implementation, tests, documentation, and
Changeset that justify the compatibility impact. Never update a baseline only
to silence verification.
