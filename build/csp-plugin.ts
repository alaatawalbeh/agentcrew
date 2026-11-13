import type { Plugin } from 'vite';
import { CSP_DEV, CSP_PROD } from '../src/shared/csp';

/** Writes the renderer's CSP as the first <meta> in <head>: strict for builds, relaxed only for the dev server. */
export function cspPlugin(): Plugin {
  let serve = false;
  return {
    name: 'agent-crew-csp',
    configResolved(config) {
      serve = config.command === 'serve';
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: serve ? CSP_DEV : CSP_PROD },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
