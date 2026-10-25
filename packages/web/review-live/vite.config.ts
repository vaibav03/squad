import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Review harness for web-live: renders every gallery story (overlays and pages) full-viewport.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: { port: 5291, strictPort: true, fs: { allow: [path.resolve(__dirname, '../../..')] } },
});
