import { useState } from 'react';
import type { ApprovalDecision, PendingApproval, SessionView } from '@shared/types';
import { bridge } from '../bridge';
import { robotFor } from '../robots/roster';

function askLine(tool: string): string {
  switch (tool) {
    case 'Bash':
      return 'wants to run a command';
    case 'Edit':
    case 'Write':
      return 'wants to change a file';
    case 'WebFetch':
      return 'wants to open a web page';
    default:
      return `wants to use ${tool}`;
  }
}

/**
 * Takes the composer's place while an agent waits on you. The full command is always shown, nothing is
 * truncated, and there is deliberately no keyboard shortcut that approves.
 */
export function ApprovalCard({ session, approval }: { session: SessionView; approval: PendingApproval }) {
  const robot = robotFor(session.robotId);
  const [sent, setSent] = useState(false);
  const answer = (decision: ApprovalDecision) => {
    if (sent) return;
    setSent(true);
    void bridge.answerApproval(session.id, approval.id, decision);
  };
  const titleId = `approval-${approval.id}`;

  return (
    <div className="composer-wrap">
      <section className="approval" aria-labelledby={titleId}>
        <p className="approval-title" id={titleId}>
          {robot.name} {askLine(approval.tool)} <span className="status-needs-approval">· needs approval</span>
        </p>
        <pre className="approval-cmd">{approval.command}</pre>
        {approval.reason && <p className="approval-meta">{approval.reason}</p>}
        {approval.cwd && (
          <p className="approval-meta">
            In <code>{approval.cwd}</code>
          </p>
        )}
        <div className="approval-actions">
          <button type="button" className="btn btn-danger" disabled={sent} onClick={() => answer('deny')}>
            Deny
          </button>
          <button type="button" className="btn" disabled={sent} onClick={() => answer('always')}>
            Always allow for {robot.name}
          </button>
          <button type="button" className="btn btn-primary" disabled={sent} onClick={() => answer('allow')}>
            Allow once
          </button>
        </div>
      </section>
    </div>
  );
}
