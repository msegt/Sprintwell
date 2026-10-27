import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  // React, React Router and the app come to about 420 kB (≈125 kB gzipped).
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 600 },
});
