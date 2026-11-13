import { STATUS_LABEL, type HostKind, type SessionView } from '@shared/types';
import { bridge } from '../bridge';
import { RobotFace } from '../robots/RobotFace';
import { robotFor } from '../robots/roster';
import { useCrew } from '../store';

const HOST_KIND: Record<HostKind, string> = {
  local: 'this computer',
  linux: 'Linux',
  macos: 'macOS',
  windows: 'Windows',
};

/** "api-server / feat/auth-v2" locally, "winbox · docs-site / docs/api-reference" on another machine. */
export function whereLabel(session: SessionView): string {
  const place = session.repo ? `${session.repo}${session.branch ? ` / ${session.branch}` : ''}` : '';
  if (session.host.kind === 'local') return place;
  return place ? `${session.host.name} · ${place}` : session.host.name;
}

function ChangesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 2.5v7M1.5 6h7M3 13.5h4.5M10.5 4.5h4M10.5 9.5h4M10.5 13.5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.75 4.25a1 1 0 0 1 1-1h3.2l1.5 1.6h5.8a1 1 0 0 1 1 1v6.9a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.75 2.75h12.5v3H1.75zM2.75 5.75v7.5h10.5v-7.5M6 8.5h4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function SessionHeader({ session }: { session: SessionView }) {
  const robot = robotFor(session.robotId);
  const openDialog = useCrew((s) => s.openDialog);
  const where = whereLabel(session);
  const hostTitle =
    session.host.kind === 'local'
      ? 'Runs on this computer'
      : `Runs on ${session.host.name} (${HOST_KIND[session.host.kind]})`;
  const hasSession = session.status !== 'sleeping';

  return (
    <header className="header">
      <RobotFace robot={robot} size={50.4} status={session.status} />
      <div className="header-text">
        <h2 className="header-name">{robot.name}</h2>
        <p className="header-task">{session.task ?? 'No task assigned'}</p>
      </div>
      <div className="header-side">
        {where && (
          <span className="header-where" title={`${hostTitle}: ${where}`}>
            {where}
          </span>
        )}
        {hasSession && (
          <span className="header-actions">
            <button
              type="button"
              className="icon-btn"
              title="Changes"
              aria-label={`${robot.name}'s changes`}
              onClick={() => openDialog({ kind: 'changes', sessionId: session.id })}
            >
              <ChangesIcon />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Open folder"
              aria-label={`Open ${robot.name}'s folder`}
              onClick={() => void bridge.openFolder(session.id)}
            >
              <FolderIcon />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Archive"
              aria-label={`Archive ${robot.name}'s session`}
              onClick={() => void bridge.archive(session.id)}
            >
              <ArchiveIcon />
            </button>
          </span>
        )}
        <span className={`pill status-${session.status}`}>{STATUS_LABEL[session.status]}</span>
      </div>
    </header>
  );
}
