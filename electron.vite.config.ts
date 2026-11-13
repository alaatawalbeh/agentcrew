import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { cspPlugin } from './build/csp-plugin';

const alias = {
  '@shared': resolve('src/shared'),
  '@renderer': resolve('src/renderer/src'),
};

export default defineConfig({
  main: {
    resolve: { alias },
  },
  // No "type": "module" in package.json, so the preload is built as CommonJS, which a sandboxed preload requires.
  preload: {
    resolve: { alias },
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), cspPlugin()],
    // Nothing gets inlined as a data: URI, so the strict CSP can stay data:-free.
    build: { assetsInlineLimit: 0 },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
  },
});
