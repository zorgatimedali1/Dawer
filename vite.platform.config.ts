import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

const platformRoot = fileURLToPath(new URL('./src/platform', import.meta.url));
const platformOutDir = fileURLToPath(new URL('./dist-platform', import.meta.url));

export default defineConfig({
  root: platformRoot,
  // Share the main app's public assets (Dawer logo) with the platform bundle.
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  build: {
    outDir: platformOutDir,
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  plugins: [
    react(),
    cloudflare({
      configPath: fileURLToPath(new URL('./wrangler.platform.jsonc', import.meta.url)),
      inspectorPort: 9230,
      persistState: { path: fileURLToPath(new URL('./.wrangler/state', import.meta.url)) },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
