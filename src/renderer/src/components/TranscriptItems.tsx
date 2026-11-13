import { useState, type ReactNode } from 'react';
import type { DiffLine, PlanItem, TranscriptItem } from '@shared/types';
import type { Robot } from '../robots/roster';

type Of<K extends TranscriptItem['kind']> = Extract<TranscriptItem, { kind: K }>;

/** Plain text with paragraphs, line breaks and `inline code`. Never interpreted as HTML. */
function renderText(text: string, caret: boolean): ReactNode {
  const paragraphs = text.split(/\n{2,}/);
  return paragraphs.map((para, p) => (
    <p key={p}>
      {para.split('\n').map((line, l) => (
        <span key={l}>
          {l > 0 && <br />}
          {line.split(/(`[^`\n]+`)/).map((part, i) =>
            part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
              <code key={i}>{part.slice(1, -1)}</code>
            ) : (
              part
            ),
          )}
        </span>
      ))}
      {caret && p === paragraphs.length - 1 && <span className="caret" aria-hidden="true" />}
    </p>
  ));
}

export function UserMessage({ item }: { item: Of<'user'> }) {
  return (
    <div className="user-msg">
      {item.broadcast && <span className="user-msg-tag">Broadcast to all</span>}
      {item.text}
    </div>
  );
}

export function AgentMessage({ item, robot }: { item: Of<'agent'>; robot: Robot }) {
  return (
    <div className="agent-msg">
      <span className="agent-name" style={{ color: robot.accent }}>
        {robot.name}
      </span>
      <div className="agent-text">{renderText(item.text, !!item.streaming)}</div>
    </div>
  );
}

const PLAN_STATE: Record<PlanItem['state'], string> = { done: 'done', active: 'in progress', pending: 'to do' };

export function PlanCard({ item }: { item: Of<'plan'> }) {
  const done = item.items.filter((step) => step.state === 'done').length;
  return (
    <section className="card plan" aria-label={`Plan, ${done} of ${item.items.length} done`}>
      <div className="plan-head">
        <span>PLAN</span>
        <span>
          {done} of {item.items.length}
        </span>
      </div>
      <ol className="plan-list">
        {item.items.map((step, i) => (
          <li key={i} className={`plan-item ${step.state}`}>
            <span className="plan-dot" aria-hidden="true" />
            <span>{step.text}</span>
            <span className="sr-only">({PLAN_STATE[step.state]})</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const DIFF_SIGN: Record<DiffLine['kind'], string> = { add: '+', del: '-', ctx: ' ', hunk: '' };

export function ToolRow({ item }: { item: Of<'tool'> }) {
  const [open, setOpen] = useState(false);
  const expandable = !!(item.diff?.length || item.output);
  return (
    <div className={`card tool ${item.state}`}>
      <button
        type="button"
        className="tool-head"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tool-name">{item.tool}</span>
        <span className="tool-target" title={item.target}>
          {item.target}
        </span>
        <span className="tool-detail">
          {item.state === 'running' ? (
            <span className="dots" aria-label="running">
              <span />
              <span />
              <span />
            </span>
          ) : (
            item.detail
          )}
        </span>
      </button>
      {open && expandable && (
        <div className="tool-body">
          {item.diff ? (
            item.diff.map((line, i) => (
              <div key={i} className={`diff-line ${line.kind}`}>
                {DIFF_SIGN[line.kind]}
                {line.text}
              </div>
            ))
          ) : (
            <pre className="term">
              <span className="term-cmd">$ {item.target}</span>
              {'\n'}
              {item.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function ApprovalNote({ item }: { item: Of<'approval'> }) {
  const verdict =
    item.decision === 'deny' ? (
      <span className="no">✕ Denied</span>
    ) : (
      <span className="yes">✓ {item.decision === 'always' ? 'Always allowed' : 'Allowed once'}</span>
    );
  return (
    <div className="approval-note">
      {verdict} · {item.tool} {item.command}
    </div>
  );
}

export function ErrorNote({ item, onRetry }: { item: Of<'error'>; onRetry?: () => void }) {
  return (
    <div className="card error-note">
      <div className="note-text">
        <p className="note-title">{item.title}</p>
        {item.detail && <p className="note-detail">{item.detail}</p>}
      </div>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function ThinkingRow({ robot }: { robot: Robot }) {
  return (
    <div className="thinking">
      <span className="agent-name" style={{ color: robot.accent }}>
        {robot.name}
      </span>
      <span className="dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="sr-only">is thinking</span>
    </div>
  );
}

export function PausedNote({ robot, pausedAt, onResume }: { robot: Robot; pausedAt?: string; onResume: () => void }) {
  return (
    <div className="card paused-note">
      <div className="note-text">
        <p className="note-title">Paused{pausedAt ? ` at ${pausedAt}` : ''}</p>
        <p className="note-detail">
          {robot.name} stopped when Agent Crew closed. Its work and history are saved, so it can carry on where it left
          off.
        </p>
      </div>
      <button type="button" className="btn btn-primary" onClick={onResume}>
        Resume
      </button>
    </div>
  );
}
