import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [react(), cloudflare()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Full-suite runs are CPU-bound in CI-like parallel mode; the default 5s
    // made interaction-heavy tests (typing + save flows) fail intermittently.
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});