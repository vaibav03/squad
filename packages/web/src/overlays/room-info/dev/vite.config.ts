import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Dev harness for the room-info overlays: a fake night village with RoomLayer on a scripted session.
// Not imported by the app. Run: pnpm exec vite --config src/overlays/room-info/dev/vite.config.ts
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 5293,
    strictPort: true,
    fs: { allow: [path.resolve(__dirname, '../../../../../..')] },
  },
});
