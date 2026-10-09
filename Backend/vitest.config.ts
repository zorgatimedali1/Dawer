import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const nodeMajor = Number(process.versions.node.split('.')[0]);
const sqliteFlag = nodeMajor < 24 ? ['--experimental-sqlite'] : [];

export default defineConfig({
  resolve: {
    alias: {
      // Lets tests import Durable Object classes under plain Node: the real
      // `cloudflare:workers` module only exists inside the Workers runtime.
      'cloudflare:workers': fileURLToPath(
        new URL('./src/tests/helpers/cloudflare-workers.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: [...sqliteFlag, '--no-warnings'],
      },
    },
  },
});
