import { useEffect } from 'react';
import { isRunning, type SessionView } from '@shared/types';
import { bridge, onEngineState, onNotice, onSelect } from './bridge';
import { ApprovalCard } from './components/ApprovalCard';
import { ChangesDialog } from './components/ChangesDialog';
import { Composer } from './components/Composer';
import { NewSessionDialog } from './components/NewSessionDialog';
import { SessionHeader } from './components/SessionHeader';
import { Sidebar } from './components/Sidebar';
import { Transcript } from './components/Transcript';
import { useCrew } from './store';

function MainPane({ session }: { session: SessionView }) {
  return (
    <main className="main">
      <SessionHeader session={session} />
      <Transcript session={session} />
      {session.pendingApproval ? (
        <ApprovalCard key={session.pendingApproval.id} session={session} approval={session.pendingApproval} />
      ) : (
        <Composer session={session} />
      )}
    </main>
  );
}

function Dialogs() {
  const dialog = useCrew((s) => s.dialog);
  const closeDialog = useCrew((s) => s.closeDialog);
  const changesFor = useCrew((s) =>
    s.dialog?.kind === 'changes' ? s.sessions.find((x) => x.id === (s.dialog as { sessionId: string }).sessionId) : undefined,
  );
  if (dialog?.kind === 'new-session') return <NewSessionDialog initialRobotId={dialog.robotId} onClose={closeDialog} />;
  if (dialog?.kind === 'changes' && changesFor) return <ChangesDialog session={changesFor} onClose={closeDialog} />;
  return null;
}

export function App() {
  const setSessions = useCrew((s) => s.setSessions);
  const select = useCrew((s) => s.select);
  const session = useCrew((s) => s.sessions.find((x) => x.id === s.selectedId) ?? null);
  const dialogOpen = useCrew((s) => s.dialog !== null);
  const openDialog = useCrew((s) => s.openDialog);
  const closeDialog = useCrew((s) => s.closeDialog);

  const setEngine = useCrew((s) => s.setEngine);
  const setNotice = useCrew((s) => s.setNotice);

  useEffect(() => bridge.subscribe((snapshot) => setSessions(snapshot.sessions)), [setSessions]);
  useEffect(() => onEngineState(setEngine), [setEngine]);
  // A desktop notification was clicked: show that robot.
  useEffect(
    () =>
      onSelect((id) => {
        closeDialog();
        select(id);
      }),
    [select, closeDialog],
  );
  // A notice (an action that couldn't run, a repo that isn't git) shows for a few seconds.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onNotice((message) => {
      setNotice(message);
      clearTimeout(timer);
      timer = setTimeout(() => setNotice(null), 8000);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [setNotice]);

  // Esc stops the selected agent's current turn (unless a dialog is open: then Esc closes the dialog).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || dialogOpen) return;
      if (!session || session.pendingApproval || !isRunning(session.status)) return;
      event.preventDefault();
      void bridge.interrupt(session.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, dialogOpen]);

  // + New session starts with the selected robot when it's asleep.
  const onNewSession = () =>
    openDialog({ kind: 'new-session', robotId: session?.status === 'sleeping' ? session.robotId : undefined });

  return (
    <div className="app">
      <Sidebar onNewSession={onNewSession} />
      {session ? <MainPane session={session} /> : <main className="main" />}
      <Dialogs />
    </div>
  );
}
