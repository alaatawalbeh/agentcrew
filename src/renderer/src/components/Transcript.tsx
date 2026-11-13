import { useLayoutEffect, useRef } from 'react';
import type { SessionView } from '@shared/types';
import { bridge } from '../bridge';
import { RobotFace } from '../robots/RobotFace';
import { robotFor } from '../robots/roster';
import {
  AgentMessage,
  ApprovalNote,
  ErrorNote,
  PausedNote,
  PlanCard,
  ThinkingRow,
  ToolRow,
  UserMessage,
} from './TranscriptItems';

/** Distance from the bottom (px) within which new content keeps the view pinned to the end. */
const STICKY_PX = 120;

export function Transcript({ session }: { session: SessionView }) {
  const robot = robotFor(session.robotId);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastSession = useRef(session.id);

  // Follow new content while the reader is at the end; jump to the end when switching agents.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (lastSession.current !== session.id) {
      lastSession.current = session.id;
      pinned.current = true;
    }
    if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [session]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_PX;
  };

  if (session.status === 'sleeping' && session.items.length === 0) {
    return (
      <div className="transcript">
        <div className="empty">
          <RobotFace robot={robot} size={90} status="sleeping" />
          <p className="empty-title">{robot.name} is sleeping</p>
          <p className="empty-detail">Give {robot.name} a task to wake it up.</p>
        </div>
      </div>
    );
  }

  const lastError = [...session.items].reverse().find((item) => item.kind === 'error');
  const toolRunning = session.items.some((item) => item.kind === 'tool' && item.state === 'running');

  return (
    <div className="transcript" ref={scroller} onScroll={onScroll}>
      <div className="column">
        {session.items.map((item) => {
          switch (item.kind) {
            case 'user':
              return <UserMessage key={item.id} item={item} />;
            case 'agent':
              return <AgentMessage key={item.id} item={item} robot={robot} />;
            case 'plan':
              return <PlanCard key={item.id} item={item} />;
            case 'tool':
              return <ToolRow key={item.id} item={item} />;
            case 'approval':
              return <ApprovalNote key={item.id} item={item} />;
            case 'error':
              return (
                <ErrorNote
                  key={item.id}
                  item={item}
                  onRetry={
                    item.retryable && item === lastError && session.status === 'stuck'
                      ? () => void bridge.retry(session.id)
                      : undefined
                  }
                />
              );
          }
        })}
        {session.status === 'thinking' && !toolRunning && <ThinkingRow robot={robot} />}
        {session.status === 'paused' && (
          <PausedNote robot={robot} pausedAt={session.pausedAt} onResume={() => void bridge.resume(session.id)} />
        )}
      </div>
    </div>
  );
}
