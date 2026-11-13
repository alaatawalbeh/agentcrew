// Turns the unified diff from `git diff` (plus the app's own notes, such as the list of new files) into files and
// lines for the Changes view. Everything stays text: nothing from the diff is ever treated as markup.
import type { DiffLine } from '@shared/types';

export interface FileChange {
  path: string;
  status: 'modified' | 'new' | 'deleted' | 'renamed';
  added: number;
  removed: number;
  lines: DiffLine[];
  binary?: boolean;
}

export interface Changes {
  files: FileChange[];
  /** Text that isn't part of a file's diff: "No changes against main.", the new-files list, a size note. */
  notes: string[];
}

const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;

export function parseChanges(text: string): Changes {
  const files: FileChange[] = [];
  const notes: string[] = [];
  let note: string[] = [];
  let file: FileChange | null = null;
  let inHunk = false;

  const endNote = () => {
    const joined = note.join('\n').trim();
    if (joined) notes.push(joined);
    note = [];
  };

  for (const line of text.split('\n')) {
    const header = FILE_HEADER.exec(line);
    if (header) {
      endNote();
      file = { path: header[2] ?? header[1] ?? '', status: 'modified', added: 0, removed: 0, lines: [] };
      files.push(file);
      inHunk = false;
      continue;
    }
    if (!file) {
      note.push(line);
      continue;
    }
    if (line.startsWith('@@')) {
      inHunk = true;
      file.lines.push({ kind: 'hunk', text: line });
      continue;
    }
    if (!inHunk) {
      // The lines between "diff --git" and the first hunk: modes, index, ---/+++, renames.
      if (line.startsWith('new file mode')) file.status = 'new';
      else if (line.startsWith('deleted file mode')) file.status = 'deleted';
      else if (line.startsWith('rename to ')) {
        file.status = 'renamed';
        file.path = line.slice('rename to '.length);
      } else if (line.startsWith('Binary files')) file.binary = true;
      else if (!/^(index |old mode|new mode|similarity|dissimilarity|rename from|copy |--- |\+\+\+ )/.test(line)) {
        // Not a diff header line: the diff has ended and the app's notes follow.
        file = null;
        if (line) note.push(line);
      }
      continue;
    }
    if (line.startsWith('+')) {
      file.added++;
      file.lines.push({ kind: 'add', text: line.slice(1) });
    } else if (line.startsWith('-')) {
      file.removed++;
      file.lines.push({ kind: 'del', text: line.slice(1) });
    } else if (line.startsWith(' ')) {
      file.lines.push({ kind: 'ctx', text: line.slice(1) });
    } else if (line.startsWith('\\')) {
      file.lines.push({ kind: 'hunk', text: line });
    } else {
      // git prefixes every line of a hunk, so anything else ends the diff: a blank separator or the app's notes.
      file = null;
      inHunk = false;
      if (line) note.push(line);
    }
  }
  endNote();
  return { files, notes };
}
