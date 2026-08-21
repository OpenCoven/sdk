/**
 * Supported TypeScript integration scaffolds.
 *
 * Templates are string constants rather than files on disk. A packed CLI has no
 * repository beside it, so anything read at generation time would have to be
 * carried in `files` and resolved relative to `import.meta.url` -- a second
 * contract to keep correct for no gain. Inlining them also means
 * `createScaffoldFiles` is pure, and a pure generator is one a test can compare
 * byte for byte.
 *
 * Every scaffold pins the SDK packages to an exact version and says in its
 * README that they are unpublished, because they are: the workspace marks each
 * package private and blocks publication, so a scaffold is installed from packed
 * tarballs today. The verifier proves that path by generating each scaffold and
 * compiling it against the tarballs it just packed.
 */

export const SCAFFOLD_TEMPLATES = ['cave-chat', 'coven-observer', 'unified-status'] as const;

export type ScaffoldTemplate = (typeof SCAFFOLD_TEMPLATES)[number];

export interface ScaffoldFile {
  /** Relative POSIX path inside the target directory. */
  path: string;
  contents: string;
}

interface TemplateDefinition {
  description: string;
  dependencies: Record<string, string>;
  readme: string;
  source: string;
}

const SDK_PACKAGE_VERSION = '0.1.0';
const TOOLING_DEPENDENCIES = {
  '@types/node': '24.13.3',
  typescript: '6.0.3',
} as const;

export function isScaffoldTemplate(value: string): value is ScaffoldTemplate {
  return (SCAFFOLD_TEMPLATES as readonly string[]).includes(value);
}

const BROWSER_NOTICE = `## Browser applications

A browser cannot connect to Cave or Coven directly in v1. Both clients take a
caller-supplied transport and never discover an endpoint or a credential, so a
browser would have to hold the credential itself and reach an origin the daemons
do not serve. Run this package in a server-side runtime you control and let the
browser talk to that.`;

const INSTALL_NOTICE = `## Install

The OpenCoven SDK packages are experimental and are not published. Build the SDK
workspace, pack the packages you need, and install the tarballs:

\`\`\`bash
corepack pnpm@10.34.0 --filter './packages/*' build
corepack pnpm@10.34.0 --filter <package> pack --pack-destination /tmp/opencoven
pnpm add file:/tmp/opencoven/<tarball>.tgz
\`\`\`

Then build and run:

\`\`\`bash
pnpm run build
pnpm start
\`\`\``;

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": [
      "ES2024"
    ],
    "types": [
      "node"
    ],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": [
    "src/**/*.ts"
  ]
}
`;

const GITIGNORE = `dist/
node_modules/
`;

const CAVE_CHAT_SOURCE = `import {
  CaveClient,
  isCaveClientError,
  type CaveFamiliar,
  type CaveTransport,
} from '@opencoven/cave-client';

/**
 * Replace this transport with calls to your own Cave deployment.
 *
 * The client never discovers an endpoint and never reads a credential. It calls
 * exactly the functions below, so the URL, the authentication, and the retry
 * policy stay yours -- which is also why this file is the only place a secret
 * would ever appear.
 */
const transport: CaveTransport = {
  health: () => Promise.resolve({ data: { status: 'ok' } }),
  familiars: () =>
    Promise.resolve({
      ok: true,
      familiars: [
        {
          id: 'demo-familiar',
          display_name: 'Demo Familiar',
          role: 'guide',
          status: 'idle',
        },
      ],
    }),
};

const cave = new CaveClient({
  transport,
  operation: { timeoutMs: 5_000 },
});

function describe(familiar: CaveFamiliar): string {
  const status = familiar.status ?? 'unknown';

  return \`\${familiar.displayName} (\${familiar.role}) [\${status}]\`;
}

try {
  await cave.health();

  const capabilities = cave.capabilities();

  if (!capabilities.familiars) {
    throw new Error('This transport does not implement the familiars operation.');
  }

  for (const familiar of await cave.familiars()) {
    process.stdout.write(\`\${describe(familiar)}\\n\`);
  }
} catch (error) {
  // Normalized errors carry a stable code and no remote prose, so they are safe
  // to log. The original transport failure stays on \`cause\` for local debugging.
  if (isCaveClientError(error)) {
    process.stderr.write(\`\${error.normalized.operation} failed: \${error.code}\\n\`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
`;

const COVEN_OBSERVER_SOURCE = `import {
  COVEN_DAEMON_PROTOCOL,
  CovenClient,
  isCovenClientError,
  type CovenTransport,
} from '@opencoven/coven-client';

/** Replace this transport with calls to your own Coven daemon. */
const transport: CovenTransport = {
  health: () =>
    Promise.resolve({
      ok: true,
      apiVersion: COVEN_DAEMON_PROTOCOL,
      covenVersion: '0.1.0',
      capabilities: {
        sessions: true,
        events: true,
        eventCursor: 'sequence',
        structuredErrors: true,
      },
    }),
};

const phases: string[] = [];
const coven = new CovenClient({ transport });

/**
 * Observers see the operation lifecycle, not its contents.
 *
 * Events carry a phase, a duration, and -- on a failure -- a normalized error.
 * There is no request or response payload on them, which is what makes it safe
 * to forward this stream to telemetry.
 */
try {
  await coven.health({
    timeoutMs: 5_000,
    observer: {
      onEvent(event) {
        phases.push(event.phase);
      },
      onObserverError(error) {
        throw error;
      },
    },
  });

  process.stdout.write(\`coven.health: \${phases.join(' -> ')}\\n\`);
} catch (error) {
  if (isCovenClientError(error)) {
    process.stderr.write(\`coven.health failed: \${error.code}\\n\`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
`;

const UNIFIED_STATUS_SOURCE = `import { CaveClient } from '@opencoven/cave-client';
import { COVEN_DAEMON_PROTOCOL, CovenClient } from '@opencoven/coven-client';
import { createOpenCovenSdk, type DiagnosticsBundle } from '@opencoven/sdk';

/** Replace both transports with calls to your own deployments. */
const sdk = createOpenCovenSdk({
  cave: new CaveClient({
    transport: {
      health: () => Promise.resolve({ data: { status: 'ok' } }),
    },
  }),
  coven: new CovenClient({
    transport: {
      health: () =>
        Promise.resolve({
          ok: true,
          apiVersion: COVEN_DAEMON_PROTOCOL,
          covenVersion: '0.1.0',
          capabilities: {
            sessions: true,
            events: true,
            eventCursor: 'sequence',
            structuredErrors: true,
          },
        }),
    },
  }),
});

const report = await sdk.healthReport({
  timeoutMs: 5_000,
  cave: { timeoutMs: 2_000 },
  coven: { timeoutMs: 2_000 },
});

process.stdout.write(\`cave: \${report.cave.status}\\n\`);
process.stdout.write(\`coven: \${report.coven.status}\\n\`);

/**
 * The bundle is built from an allowlist: versions, capabilities, endpoint
 * shapes, operation counts, and normalized error codes. Prompts, tokens,
 * attachments, and event payloads are never carried, so this output is safe to
 * paste into a support issue.
 */
const bundle: DiagnosticsBundle = await sdk.diagnostics({
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  discovery: [{ label: 'cave', url: 'http://127.0.0.1:4000/api' }],
});

process.stdout.write(\`\${JSON.stringify(bundle, null, 2)}\\n\`);
`;

const TEMPLATES: Record<ScaffoldTemplate, TemplateDefinition> = {
  'cave-chat': {
    description: 'Cave client wired to a caller-supplied transport, reading the familiar roster.',
    dependencies: { '@opencoven/cave-client': SDK_PACKAGE_VERSION },
    readme: `A Cave client with a caller-supplied transport. It checks health, confirms the
transport implements the familiar operations, and prints the roster.

Cave models, transports, and normalized errors stay distinct from Coven's. This
scaffold depends on \`@opencoven/cave-client\` alone.`,
    source: CAVE_CHAT_SOURCE,
  },
  'coven-observer': {
    description: 'Coven client with a lifecycle observer over a caller-supplied transport.',
    dependencies: { '@opencoven/coven-client': SDK_PACKAGE_VERSION },
    readme: `A Coven client that forwards operation lifecycle events to an observer.

Observer events carry a phase, a duration, and a normalized error -- never a
request or response payload -- so the stream is safe to send to telemetry.`,
    source: COVEN_OBSERVER_SOURCE,
  },
  'unified-status': {
    description: 'Unified Cave and Coven status plus a sanitized diagnostics bundle.',
    dependencies: {
      '@opencoven/cave-client': SDK_PACKAGE_VERSION,
      '@opencoven/coven-client': SDK_PACKAGE_VERSION,
      '@opencoven/sdk': SDK_PACKAGE_VERSION,
    },
    readme: `Coordinates separately configured Cave and Coven clients, reports each client's
status independently, and prints a sanitized diagnostics bundle.

The bundle is assembled from an allowlist. It excludes prompts, tokens,
attachments, and event payloads, and it reduces an endpoint to its shape: a
non-loopback host is reported as \`redacted\`, and a credential in the URL is
reported as a boolean rather than repeated.`,
    source: UNIFIED_STATUS_SOURCE,
  },
};

function packageManifest(template: ScaffoldTemplate): string {
  const definition = TEMPLATES[template];

  return `${JSON.stringify(
    {
      name: `opencoven-${template}`,
      private: true,
      version: '0.0.0',
      description: definition.description,
      type: 'module',
      scripts: {
        build: 'tsc --pretty false',
        start: 'node dist/index.js',
        typecheck: 'tsc --pretty false --noEmit',
      },
      dependencies: definition.dependencies,
      devDependencies: { ...TOOLING_DEPENDENCIES },
    },
    null,
    2,
  )}\n`;
}

function readme(template: ScaffoldTemplate): string {
  const definition = TEMPLATES[template];

  return `# opencoven-${template}

${definition.readme}

${INSTALL_NOTICE}

${BROWSER_NOTICE}
`;
}

/**
 * The files one scaffold is made of, in a stable order.
 *
 * Pure: the same template always produces the same bytes, which is what lets
 * the packed-package verifier assert that the packed CLI and the workspace CLI
 * generate the same scaffold.
 */
export function createScaffoldFiles(template: ScaffoldTemplate): ScaffoldFile[] {
  return [
    { path: '.gitignore', contents: GITIGNORE },
    { path: 'README.md', contents: readme(template) },
    { path: 'package.json', contents: packageManifest(template) },
    { path: 'src/index.ts', contents: TEMPLATES[template].source },
    { path: 'tsconfig.json', contents: TSCONFIG },
  ];
}

export function describeScaffoldTemplate(template: ScaffoldTemplate): string {
  return TEMPLATES[template].description;
}
