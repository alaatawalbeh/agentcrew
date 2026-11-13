import type { EngineState } from '@shared/crew';
import { NEEDS_YOU, STATUS_LABEL, type SessionView } from '@shared/types';
import { bridge } from '../bridge';
import { RobotFace } from '../robots/RobotFace';
import { robotFor } from '../robots/roster';
import { useCrew } from '../store';

function subtitle(sessions: SessionView[]): string {
  const count = sessions.length;
  const needYou = sessions.filter((s) => NEEDS_YOU.includes(s.status)).length;
  const base = `${count} ${count === 1 ? 'session' : 'sessions'}`;
  return needYou ? `${base} · ${needYou} need${needYou === 1 ? 's' : ''} you` : base;
}

/** One line under the subtitle when the engine isn't simply ready (nothing in the sample crew or when all is well). */
function engineNote(engine: EngineState): { text: string; tone: 'info' | 'warn' } | null {
  switch (engine.state) {
    case 'starting':
      return { text: 'Starting the engine…', tone: 'info' };
    case 'unavailable':
      return { text: engine.detail, tone: 'warn' };
    case 'ready':
      return engine.claude === 'available'
        ? null
        : { text: 'Claude Code was not found. Install it and run `claude auth login`.', tone: 'warn' };
    default:
      return null;
  }
}

function SessionRow({ session, selected, onSelect }: { session: SessionView; selected: boolean; onSelect: () => void }) {
  const robot = robotFor(session.robotId);
  const label = STATUS_LABEL[session.status];
  const task = session.task ?? 'No task assigned';
  return (
    <div className={selected ? 'row is-selected' : 'row'}>
      <button
        type="button"
        className="row-hit"
        aria-current={selected ? 'true' : undefined}
        aria-label={`${robot.name}: ${task}. ${label}.`}
        onClick={onSelect}
      />
      <RobotFace robot={robot} size={36} status={session.status} />
      <span className="row-text">
        <span className="row-name">{robot.name}</span>
        <span className="row-task" title={task}>
          {task}
        </span>
      </span>
      {session.status === 'paused' ? (
        <button type="button" className="row-resume" onClick={() => void bridge.resume(session.id)}>
          Resume
        </button>
      ) : (
        <span className={`row-status status-${session.status}`}>{label}</span>
      )}
    </div>
  );
}

export function Sidebar({ onNewSession }: { onNewSession: () => void }) {
  const sessions = useCrew((s) => s.sessions);
  const selectedId = useCrew((s) => s.selectedId);
  const select = useCrew((s) => s.select);
  const engine = useCrew((s) => s.engine);
  const notice = useCrew((s) => s.notice);
  const engineLine = engineNote(engine);

  return (
    <aside className="sidebar" aria-label="Crew">
      <header className="crew-head">
        <h1 className="crew-title">Crew</h1>
        <p className="crew-sub">{subtitle(sessions)}</p>
        {engineLine && (
          <p className={`crew-engine ${engineLine.tone}`} role="status">
            {engineLine.text}
          </p>
        )}
        {notice && (
          <p className="crew-engine warn" role="alert">
            {notice}
          </p>
        )}
      </header>
      <ul className="crew-list">
        {sessions.map((session) => (
          <li key={session.id}>
            <SessionRow session={session} selected={session.id === selectedId} onSelect={() => select(session.id)} />
          </li>
        ))}
      </ul>
      <footer className="crew-foot">
        <button type="button" className="new-session" onClick={onNewSession}>
          + New session
        </button>
      </footer>
    </aside>
  );
}
