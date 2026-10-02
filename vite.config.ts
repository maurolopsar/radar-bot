import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

const apiPort = process.env.PORT ?? '8787';

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: true,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
  preview: {
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
});
