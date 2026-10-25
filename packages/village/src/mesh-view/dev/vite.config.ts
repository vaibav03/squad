import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import base from '../../../vite.config';

/** Same asset serving as the world harness, rooted at this folder. */
export default defineConfig({
  ...base,
  root: fileURLToPath(new URL('./', import.meta.url)),
  server: {
    port: 5191,
    strictPort: false,
    fs: { allow: [fileURLToPath(new URL('../../../../..', import.meta.url))] },
  },
});
