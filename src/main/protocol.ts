// Serves the built renderer from app://crew instead of file://, so the page has one fixed origin to check against
// and every response carries the production CSP.
import { net, protocol } from 'electron';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CSP_PROD } from '@shared/csp';

export const APP_SCHEME = 'app';
export const APP_HOST = 'crew';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/** Must run before the app's `ready` event. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/** Must run after `ready`. Only files inside out/renderer are served; everything else is 404 or 403. */
export function serveAppScheme(): void {
  const root = resolve(__dirname, '../renderer');
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST || request.method !== 'GET') return new Response('Not found', { status: 404 });

    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (pathname.includes('\0')) return new Response('Bad request', { status: 400 });

    const file = resolve(root, `.${pathname}`);
    if (!file.startsWith(root + sep)) return new Response('Forbidden', { status: 403 });

    try {
      const res = await net.fetch(pathToFileURL(file).toString());
      if (!res.ok) return new Response('Not found', { status: 404 });
      const headers = new Headers({
        'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Security-Policy': CSP_PROD,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      });
      return new Response(res.body, { status: 200, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
