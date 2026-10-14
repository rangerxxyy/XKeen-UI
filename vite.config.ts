import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/health': 'http://127.0.0.1:1001',
      '/api': 'http://127.0.0.1:1001',
    },
  },
  build: { outDir: 'release/web', emptyOutDir: true },
});
