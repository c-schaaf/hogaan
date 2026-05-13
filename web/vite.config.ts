import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: here,
  // Read env from the repo root .env so VITE_SUPABASE_URL etc. can be
  // defined alongside the backend's SUPABASE_URL.
  envDir: path.resolve(here, '..'),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    sourcemap: true,
  },
});
