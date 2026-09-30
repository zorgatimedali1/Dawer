import { defineConfig } from 'vitest/config';

const nodeMajor = Number(process.versions.node.split('.')[0]);
const sqliteFlag = nodeMajor < 24 ? ['--experimental-sqlite'] : [];

export default defineConfig({
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
