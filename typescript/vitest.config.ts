import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The tests run against the sources: each workspace package resolves to its src/index.ts, so
// a test never needs a previous build.
const packages = [
  'reportman-lib',
  'reportman-metafile',
  'reportman-text',
  'reportman-pdf',
  'reportman-engine',
  'reportman-node',
  'reportman-driver-postgres',
  'reportman-driver-firebird',
  'reportman-driver-mysql',
  'reportman-driver-http',
  'reportman-driver-mssql',
];

export default defineConfig({
  resolve: {
    alias: packages.map((name) => ({
      find: new RegExp(`^${name}$`),
      replacement: fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
    })),
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    testTimeout: 60000,
  },
});
