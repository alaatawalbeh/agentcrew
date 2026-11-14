// The Changes view for a robot that works straight in a plain folder: without git there's nothing to diff against,
// so it shows the edits the robot made with its file tools, in order, as a unified diff the view can read.
import type { DiffLine, TranscriptItem } from '@shared/types';

const SIGN: Record<DiffLine['kind'], string> = { add: '+', del: '-', ctx: ' ', hunk: '' };

export function folderChanges(items: readonly TranscriptItem[], folderName: string): string {
  const edits = items.filter(
    (item): item is Extract<TranscriptItem, { kind: 'tool' }> =>
      item.kind === 'tool' && item.state === 'ok' && !!item.diff?.length,
  );
  const note =
    `${folderName} isn't a git repository, so this lists the edits made with the file tools, oldest first. ` +
    'Changes made by commands the robot ran (scripts, installs, moves) aren\'t shown.';
  if (!edits.length) return `No file edits yet.\n\n${note}`;
  const blocks = edits.map((edit) => {
    const lines = edit.diff ?? [];
    const body = lines.map((line) => `${SIGN[line.kind]}${line.text}`);
    // Every +/- line has to sit in a hunk; edits made from old and new text have no hunk header of their own.
    if (lines[0]?.kind !== 'hunk') body.unshift(`@@ ${edit.tool} @@`);
    return [`diff --git a/${edit.target} b/${edit.target}`, `--- a/${edit.target}`, `+++ b/${edit.target}`, ...body].join('\n');
  });
  return `${blocks.join('\n')}\n\n${note}`;
}
