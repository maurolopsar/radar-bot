import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

const apiPort = process.env.PORT ?? '8787';

export default defineConfig({
  // Rutas relativas: permite servir la app desde un subdirectorio (p. ej. GitHub Pages).
  base: './',
  plugins: [preact()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: { maplibre: ['maplibre-gl'] },
      },
    },
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
