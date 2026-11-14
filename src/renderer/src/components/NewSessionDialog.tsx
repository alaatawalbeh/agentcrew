import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  MAX_ALLOW_RULES,
  MAX_EXTRA_FOLDERS,
  MODES,
  sessionIdFor,
  type FolderChoice,
  type ModelOption,
  type RepoChoice,
} from '@shared/crew';
import { bridge } from '../bridge';
import { RobotFace } from '../robots/RobotFace';
import { robotFor, type Robot } from '../robots/roster';
import { useCrew } from '../store';
import { Modal } from './Modal';
import { freeRobotIds, readRules } from './newSession';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Busy = null | 'repo' | 'folder' | 'start';

export function NewSessionDialog({ initialRobotId, onClose }: { initialRobotId?: string; onClose: () => void }) {
  const sessions = useCrew((s) => s.sessions);
  const select = useCrew((s) => s.select);
  const free = useMemo(() => freeRobotIds(sessions), [sessions]);
  /** A robot under the name you gave it (robots outside your crew have their roster names). */
  const named = (id: string): Robot => {
    const robot = robotFor(id);
    const name = sessions.find((s) => s.robotId === id)?.name;
    return name ? { ...robot, name } : robot;
  };

  const [robotId, setRobotId] = useState(() =>
    initialRobotId && free.includes(initialRobotId) ? initialRobotId : (free[0] ?? ''),
  );
  const [task, setTask] = useState('');
  const [repo, setRepo] = useState<RepoChoice | null>(null);
  const [base, setBase] = useState('');
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [model, setModel] = useState('');
  const [modeId, setModeId] = useState('auto');
  const [folders, setFolders] = useState<FolderChoice[]>([]);
  const [rulesText, setRulesText] = useState('');
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  // A robot can be taken while the dialog is open (a task typed to it): move on to another free one.
  useEffect(() => {
    if (robotId && !free.includes(robotId)) setRobotId(free[0] ?? '');
  }, [free, robotId]);

  useEffect(() => {
    let live = true;
    bridge.listModels().then(
      (list) => {
        if (!live) return;
        setModels(list);
        setModel((current) => current || list[0]?.id || '');
      },
      (e) => live && setError(message(e)),
    );
    return () => {
      live = false;
    };
  }, []);

  const robot = robotId ? named(robotId) : null;
  const { rules, invalid } = readRules(rulesText);
  const mode = MODES.find((m) => m.id === modeId);
  const extras = folders.length + rules.length + (trust ? 1 : 0);
  const ready =
    !!robot &&
    !!task.trim() &&
    !!repo &&
    (!repo.git || !!base) &&
    !!model &&
    !invalid.length &&
    rules.length <= MAX_ALLOW_RULES;

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const chooseRepo = () =>
    run('repo', async () => {
      const choice = await bridge.pickRepo();
      if (!choice) return;
      setRepo(choice);
      setBase(choice.branches.includes(choice.currentBranch) ? choice.currentBranch : (choice.branches[0] ?? ''));
    });

  const addFolder = () =>
    run('folder', async () => {
      const choice = await bridge.pickFolder();
      if (choice && !folders.some((f) => f.path === choice.path)) setFolders((list) => [...list, choice]);
    });

  const start = () => {
    if (!ready || !robot || !repo) return;
    void run('start', async () => {
      const { started } = await bridge.createSession({
        robotId: robot.id,
        task: task.trim(),
        repoToken: repo.token,
        baseBranch: base,
        model,
        modeId,
        folderTokens: folders.map((f) => f.token),
        allowRules: rules,
        trustProjectSettings: trust,
      });
      // Not started means you said no to the extra powers: the dialog stays open so you can change them.
      if (!started) return;
      select(sessionIdFor(robot.id));
      onClose();
    });
  };

  return (
    <Modal label="New session" className="ns" onClose={onClose} initialFocus="#ns-task">
      <form
        className="ns-form"
        onSubmit={(event) => {
          event.preventDefault();
          start();
        }}
      >
        <header className="modal-head">
          <h2 className="modal-title">New session</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="ns-body">
          <fieldset className="ns-field">
            <legend className="ns-label">Robot</legend>
            {free.length ? (
              <div className="ns-robots" role="radiogroup" aria-label="Robot">
                {free.map((id) => {
                  const r = named(id);
                  const on = id === robotId;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={on ? 'ns-robot is-on' : 'ns-robot'}
                      style={{ '--hue': r.accent } as CSSProperties}
                      onClick={() => setRobotId(id)}
                    >
                      <RobotFace robot={r} size={40} status="sleeping" face={on ? 'ready' : 'idle'} />
                      <span>{r.name}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="ns-hint">Every robot has a session. Archive or delete one to free it up.</p>
            )}
          </fieldset>

          <label className="ns-field">
            <span className="ns-label">Task</span>
            <textarea
              id="ns-task"
              className="ns-input ns-task"
              rows={4}
              value={task}
              maxLength={20000}
              placeholder={robot ? `What should ${robot.name} work on?` : 'What should the robot work on?'}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  start();
                }
              }}
            />
          </label>

          <div className="ns-pair">
            <div className="ns-field">
              <span className="ns-label" id="ns-repo-label">
                Project folder
              </span>
              <button
                type="button"
                className={repo ? 'ns-input ns-repo is-set' : 'ns-input ns-repo'}
                aria-labelledby="ns-repo-label"
                disabled={busy === 'repo'}
                onClick={() => void chooseRepo()}
              >
                {repo ? (
                  <>
                    <span className="ns-repo-name">{repo.name}</span>
                    <span className="ns-repo-path" title={repo.path}>
                      {repo.path}
                    </span>
                  </>
                ) : (
                  <span className="ns-placeholder">{busy === 'repo' ? 'Choosing…' : 'Choose a folder…'}</span>
                )}
              </button>
            </div>
            <label className="ns-field">
              <span className="ns-label">Base branch</span>
              <select
                className="ns-input"
                value={base}
                disabled={!repo || !repo.branches.length}
                onChange={(e) => setBase(e.target.value)}
              >
                {!repo && <option value="">Choose a folder first</option>}
                {repo && !repo.git && <option value="">None: not a git repo</option>}
                {repo?.git && !repo.branches.length && <option value="">No branches</option>}
                {repo?.branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {repo && !repo.git && (
            <p className="ns-hint ns-in-place">
              {robot?.name ?? 'The robot'} works directly in this folder and changes your files as it goes: there's no
              branch to review first. Make it a git repo if you want that.
            </p>
          )}

          <div className="ns-pair">
            <label className="ns-field">
              <span className="ns-label">Model</span>
              <select
                className="ns-input"
                value={model}
                disabled={!models}
                onChange={(e) => setModel(e.target.value)}
              >
                {!models && <option value="">Loading…</option>}
                {models?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ns-field">
              <span className="ns-label">Permissions</span>
              <select className="ns-input" value={modeId} onChange={(e) => setModeId(e.target.value)}>
                {MODES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {mode && <p className="ns-hint ns-mode-hint">{mode.detail}</p>}

          <details className="ns-more">
            <summary>
              More options{extras ? <span className="ns-count">{extras}</span> : null}
            </summary>

            <div className="ns-field">
              <span className="ns-label">Extra folders</span>
              {folders.length > 0 && (
                <ul className="ns-folders">
                  {folders.map((f) => (
                    <li key={f.token}>
                      <span title={f.path}>{f.path}</span>
                      <button
                        type="button"
                        className="icon-btn small"
                        aria-label={`Remove ${f.path}`}
                        onClick={() => setFolders((list) => list.filter((x) => x.token !== f.token))}
                      >
                        <CloseIcon />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="btn ns-add"
                disabled={busy === 'folder' || folders.length >= MAX_EXTRA_FOLDERS}
                onClick={() => void addFolder()}
              >
                + Add folder
              </button>
              <p className="ns-hint">Folders outside the project the robot may read and change.</p>
            </div>

            <label className="ns-field">
              <span className="ns-label">Allow without asking</span>
              <textarea
                className="ns-input ns-rules"
                rows={3}
                value={rulesText}
                spellCheck={false}
                placeholder={'Bash(npm test *)\nBash(git status)'}
                aria-invalid={invalid.length ? true : undefined}
                onChange={(e) => setRulesText(e.target.value)}
              />
              {invalid.length ? (
                <p className="ns-hint warn">
                  Not a permission rule: {invalid.join(', ')}. Use a form like Bash(npm test *).
                </p>
              ) : (
                <p className="ns-hint">One Claude Code permission rule per line.</p>
              )}
            </label>

            <label className="ns-check">
              <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
              <span>
                <span className="ns-check-title">
                  Trust this {repo && !repo.git ? 'folder' : 'repo'}'s Claude settings
                </span>
                <span className="ns-hint">
                  Loads its CLAUDE.md and .claude settings, hooks and allow rules included. Leave off for repos you
                  didn't write.
                </span>
              </span>
            </label>
          </details>
        </div>

        <footer className="modal-foot">
          <p className="ns-error" role="alert">
            {error}
          </p>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!ready || busy === 'start'}>
            {busy === 'start' ? 'Starting…' : robot ? `Start ${robot.name}` : 'Start'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
