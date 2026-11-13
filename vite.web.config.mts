// Renderer-only preview in a normal browser (no Electron), using the sample bridge.
//   npm run dev:web  →  http://127.0.0.1:5174/   (add ?scenario=design for exactly the design's six agents)
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { cspPlugin } from './build/csp-plugin';

export default defineConfig({
  root: resolve('src/renderer'),
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src'),
    },
  },
  plugins: [react(), cspPlugin()],
  build: { assetsInlineLimit: 0 },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    // Lets the design SVG be opened from this server for side-by-side comparison.
    fs: { allow: [resolve('.')] },
  },
});
