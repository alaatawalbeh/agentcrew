import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionView } from '@shared/types';
import { bridge } from '../bridge';
import { robotFor } from '../robots/roster';
import { parseChanges, type FileChange } from './changes';
import { Modal } from './Modal';
import { CloseIcon } from './NewSessionDialog';
import { whereLabel } from './SessionHeader';

const SIGN = { add: '+', del: '-', ctx: ' ', hunk: '' } as const;
const STATUS = { modified: '', new: 'new', deleted: 'deleted', renamed: 'renamed' } as const;

function FileDiff({ file }: { file: FileChange }) {
  return (
    <details className="change-file" open={file.lines.length <= 600}>
      <summary className="change-head">
        <span className="change-path" title={file.path}>
          {file.path}
        </span>
        {STATUS[file.status] && <span className="change-tag">{STATUS[file.status]}</span>}
        <span className="change-stat">
          <span className="add">+{file.added}</span> <span className="del">−{file.removed}</span>
        </span>
      </summary>
      <div className="change-lines">
        {file.binary && <div className="diff-line hunk">Binary file changed</div>}
        {file.lines.map((line, i) => (
          <div key={i} className={`diff-line ${line.kind}`}>
            {SIGN[line.kind]}
            {line.text}
          </div>
        ))}
      </div>
    </details>
  );
}

type Load = { state: 'loading' } | { state: 'ready'; text: string } | { state: 'failed'; error: string };

/** The robot's changes against the branch it started from, committed or not. */
export function ChangesDialog({ session, onClose }: { session: SessionView; onClose: () => void }) {
  const robot = robotFor(session.robotId);
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  const refresh = useCallback(() => {
    setLoad({ state: 'loading' });
    bridge.changes(session.id).then(
      (text) => setLoad({ state: 'ready', text }),
      (e: unknown) => setLoad({ state: 'failed', error: e instanceof Error ? e.message : String(e) }),
    );
  }, [session.id]);
  useEffect(refresh, [refresh]);

  const changes = useMemo(() => (load.state === 'ready' ? parseChanges(load.text) : null), [load]);
  const added = changes?.files.reduce((n, f) => n + f.added, 0) ?? 0;
  const removed = changes?.files.reduce((n, f) => n + f.removed, 0) ?? 0;
  const count = changes?.files.length ?? 0;

  return (
    <Modal label={`${robot.name}'s changes`} className="changes" onClose={onClose} closeOnBackdrop initialFocus=".modal-close">
      <header className="modal-head">
        <div className="changes-title">
          <h2 className="modal-title">{robot.name}'s changes</h2>
          <p className="changes-where">
            {whereLabel(session)}
            {changes && count > 0 && (
              <>
                {' · '}
                {count} {count === 1 ? 'file' : 'files'} <span className="add">+{added}</span>{' '}
                <span className="del">−{removed}</span>
              </>
            )}
          </p>
        </div>
        <button type="button" className="btn" onClick={refresh} disabled={load.state === 'loading'}>
          Refresh
        </button>
        <button type="button" className="btn" onClick={() => void bridge.openFolder(session.id)}>
          Open folder
        </button>
        <button type="button" className="icon-btn modal-close" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className="changes-body">
        {load.state === 'loading' && <p className="changes-note">Reading the worktree…</p>}
        {load.state === 'failed' && <p className="changes-note warn">{load.error}</p>}
        {changes?.files.map((file, i) => <FileDiff key={`${file.path}-${i}`} file={file} />)}
        {changes?.notes.map((note, i) => (
          <pre key={i} className="changes-note">
            {note}
          </pre>
        ))}
      </div>
    </Modal>
  );
}
