import { useEffect, useRef, useState } from 'react';
import { MAX_ROBOT_NAME } from '@shared/crew';
import { STATUS_LABEL, type HostKind, type SessionView } from '@shared/types';
import { bridge } from '../bridge';
import { RobotFace } from '../robots/RobotFace';
import { robotOf } from '../robots/roster';
import { useCrew } from '../store';
import { whereLabel } from './where';

const HOST_KIND: Record<HostKind, string> = {
  local: 'this computer',
  linux: 'Linux',
  macos: 'macOS',
  windows: 'Windows',
};

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

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.5 2.5l3 3-8 8H2.5v-3zM9 4l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4.25h11M6 4.25v-1.5h4v1.5M3.75 4.25l.75 9h7l.75-9M6.75 7v4M9.25 7v4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** The robot's name; click it (or press F2) to rename. Enter or leaving the field saves, Esc cancels. */
function RobotName({ session }: { session: SessionView }) {
  const robot = robotOf(session);
  const renaming = useCrew((s) => s.renamingId === session.id);
  const setRenaming = useCrew((s) => s.setRenaming);
  const [draft, setDraft] = useState(robot.name);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renaming) return;
    done.current = false;
    setDraft(robot.name);
    setError(null);
    input.current?.focus();
    input.current?.select();
    // Only when renaming starts: a name change while typing must not reset the field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renaming]);

  const finish = async (save: boolean) => {
    if (done.current) return;
    if (!save || draft.trim() === robot.name) {
      done.current = true;
      setRenaming(null);
      return;
    }
    try {
      await bridge.rename(session.id, draft);
      done.current = true;
      setRenaming(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      input.current?.focus();
    }
  };

  if (!renaming) {
    return (
      <div className="name-line">
        {/* Clicking the name renames too; the pencil button is the keyboard way (or F2). */}
        <h2 className="header-name" title="Click to rename" onClick={() => setRenaming(session.id)}>
          {robot.name}
        </h2>
        <button
          type="button"
          className="icon-btn small rename-btn"
          title="Rename (F2)"
          aria-label={`Rename ${robot.name}`}
          onClick={() => setRenaming(session.id)}
        >
          <PencilIcon />
        </button>
      </div>
    );
  }
  return (
    <form
      className="rename"
      onSubmit={(event) => {
        event.preventDefault();
        void finish(true);
      }}
    >
      <input
        ref={input}
        className="rename-input"
        value={draft}
        maxLength={MAX_ROBOT_NAME}
        spellCheck={false}
        aria-label={`New name for ${robot.name}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'rename-error' : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // Esc here cancels the rename; it must not also stop the robot.
            e.preventDefault();
            e.stopPropagation();
            void finish(false);
          }
        }}
        onBlur={() => void finish(!error)}
      />
      {error && (
        <span id="rename-error" className="rename-error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

export function SessionHeader({ session }: { session: SessionView }) {
  const robot = robotOf(session);
  const openDialog = useCrew((s) => s.openDialog);
  const where = whereLabel(session);
  const hostTitle =
    session.workspace === 'folder'
      ? `Works directly in this folder (it isn't a git repository)`
      : session.host.kind === 'local'
        ? 'Runs on this computer'
        : `Runs on ${session.host.name} (${HOST_KIND[session.host.kind]})`;
  const hasSession = session.status !== 'sleeping';

  return (
    <header className="header">
      <RobotFace robot={robot} size={50.4} status={session.status} />
      <div className="header-text">
        <RobotName key={session.id} session={session} />
        <p className="header-task">{session.task ?? 'No task assigned'}</p>
      </div>
      <div className="header-side">
        {where && (
          <span className="header-where" title={`${hostTitle}: ${where}`}>
            {where}
          </span>
        )}
        <span className="header-actions">
          {hasSession && (
            <>
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
            </>
          )}
          <button
            type="button"
            className="icon-btn danger"
            title="Delete"
            aria-label={`Delete ${robot.name}`}
            onClick={() => void bridge.remove(session.id)}
          >
            <TrashIcon />
          </button>
        </span>
        <span className={`pill status-${session.status}`}>{STATUS_LABEL[session.status]}</span>
      </div>
    </header>
  );
}
