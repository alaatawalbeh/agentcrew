// App-wide lockdown: no webviews, no navigation away from the app, no new windows, no device permissions.
import { shell, type Session, type WebContents } from 'electron';

/** scheme://host[:port]. WHATWG gives custom schemes an opaque "null" origin, so it's built by hand. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function isSafeExternal(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function hardenWebContents(contents: WebContents, allowedOrigin: () => string): void {
  contents.on('will-attach-webview', (event) => event.preventDefault());

  const keepInApp = (event: { preventDefault: () => void }, url: string) => {
    if (originOf(url) !== allowedOrigin()) event.preventDefault();
  };
  contents.on('will-navigate', keepInApp);
  contents.on('will-redirect', keepInApp);

  // Links never open inside the app. Plain https links go to the system browser; anything else is dropped.
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

export function denyAllPermissions(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
}
