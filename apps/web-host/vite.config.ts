import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  server: { port: 5180, strictPort: false, fs: { allow: [resolve(__dirname, '../..')] } },
  preview: { port: 5180 },
  build: { sourcemap: true, chunkSizeWarningLimit: 700 },
});
