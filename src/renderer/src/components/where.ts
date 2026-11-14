import type { SessionView } from '@shared/types';

/**
 * "api-server / feat/auth-v2" locally, "winbox · docs-site / docs/api-reference" on another machine, and
 * "landing-page · in place" for a plain folder the robot works in directly.
 */
export function whereLabel(session: SessionView): string {
  const place = session.repo
    ? `${session.repo}${session.branch ? ` / ${session.branch}` : session.workspace === 'folder' ? ' · in place' : ''}`
    : '';
  if (session.host.kind === 'local') return place;
  return place ? `${session.host.name} · ${place}` : session.host.name;
}
