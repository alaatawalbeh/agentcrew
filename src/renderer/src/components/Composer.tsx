import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { isRunning, type SessionView } from '@shared/types';
import { bridge } from '../bridge';
import { robotFor } from '../robots/roster';
import { useCrew } from '../store';

/** Something is actually in flight: thinking, a reply streaming in, or a tool running. */
function isWorking(session: SessionView): boolean {
  if (!isRunning(session.status)) return false;
  if (session.status === 'thinking') return true;
  return session.items.some(
    (item) => (item.kind === 'agent' && item.streaming) || (item.kind === 'tool' && item.state === 'running'),
  );
}

export function Composer({ session }: { session: SessionView }) {
  const robot = robotFor(session.robotId);
  const broadcast = useCrew((s) => s.broadcast);
  const setBroadcast = useCrew((s) => s.setBroadcast);
  const draft = useCrew((s) => s.drafts[session.id] ?? '');
  const setDraft = useCrew((s) => s.setDraft);
  const input = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to the CSS max-height.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const placeholder = broadcast
    ? 'Message every agent that is awake…'
    : session.status === 'sleeping'
      ? `Give ${robot.name} a task…`
      : session.status === 'paused'
        ? `Message ${robot.name} to resume…`
        : `Message ${robot.name}…`;

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft(session.id, '');
    void (broadcast ? bridge.broadcast(text) : bridge.send(session.id, text));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer-wrap">
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={input}
          rows={1}
          value={draft}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => setDraft(session.id, event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="composer-bar">
          <button
            type="button"
            className="broadcast"
            aria-pressed={broadcast}
            onClick={() => setBroadcast(!broadcast)}
          >
            Broadcast to all
          </button>
          <span className="hint">{isWorking(session) ? 'Esc to stop' : 'Enter to send'}</span>
          <button type="submit" className="btn btn-primary send">
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
