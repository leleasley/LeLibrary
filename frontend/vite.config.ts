import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The production bundle is served by the existing Express app under /app, so
// asset URLs are rooted there. Express keeps owning every API, addon protocol,
// image and legacy page route.
export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    // prerender-home.mjs reads it to link the home page's own CSS into
    // home.html, then deletes it (it is build metadata, not a public file).
    manifest: true,
  },
  server: {
    port: 5273,
    // Vite dev server proxies the API to the running Express instance so the
    // React app talks to real backend behaviour without CORS games.
    proxy: {
      '/api': 'http://127.0.0.1:7861',
      '/health': 'http://127.0.0.1:7861',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
