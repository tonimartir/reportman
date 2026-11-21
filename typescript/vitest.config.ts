import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The tests run against the sources: each workspace package (@reportman/X, in packages/reportman-X)
// resolves to its src/index.ts, so a test never needs a previous build.
const packages = [
  'lib',
  'metafile',
  'text',
  'pdf',
  'engine',
  'node',
  'driver-postgres',
  'driver-firebird',
  'driver-mysql',
  'driver-http',
  'driver-mssql',
];

export default defineConfig({
  resolve: {
    alias: packages.map((name) => ({
      find: new RegExp(`^@reportman/${name}$`),
      replacement: fileURLToPath(new URL(`./packages/reportman-${name}/src/index.ts`, import.meta.url)),
    })),
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'tools/**/*.test.ts'],
    testTimeout: 60000,
  },
});
