import { create } from 'zustand';
import type { EngineState } from '@shared/crew';
import type { SessionView } from '@shared/types';

const SELECTED_KEY = 'agent-crew:selected';

// The remembered selection is a convenience only; storage can be missing or blocked.
const readSelected = (): string | null => {
  try {
    return window.localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
};
const writeSelected = (id: string) => {
  try {
    window.localStorage.setItem(SELECTED_KEY, id);
  } catch {
    // ignore
  }
};

export type Dialog = { kind: 'new-session'; robotId?: string } | { kind: 'changes'; sessionId: string };

interface CrewState {
  sessions: SessionView[];
  selectedId: string | null;
  /** A session to select as soon as it shows up: the remembered one at launch, or a robot that was just started. */
  wantedId: string | null;
  broadcast: boolean;
  drafts: Record<string, string>;
  engine: EngineState;
  notice: string | null;
  dialog: Dialog | null;
  /** The session whose robot is being renamed in the header. */
  renamingId: string | null;
  setSessions(sessions: SessionView[]): void;
  select(id: string): void;
  setBroadcast(on: boolean): void;
  setDraft(sessionId: string, text: string): void;
  setEngine(engine: EngineState): void;
  setNotice(notice: string | null): void;
  openDialog(dialog: Dialog): void;
  closeDialog(): void;
  setRenaming(id: string | null): void;
}

export const useCrew = create<CrewState>((set) => ({
  sessions: [],
  selectedId: null,
  wantedId: readSelected(),
  broadcast: false,
  drafts: {},
  engine: { state: 'starting' },
  notice: null,
  dialog: null,
  renamingId: null,
  setEngine: (engine) => set({ engine }),
  setNotice: (notice) => set({ notice }),
  setSessions: (sessions) =>
    set((state) => {
      if (state.wantedId && sessions.some((s) => s.id === state.wantedId)) {
        return { sessions, selectedId: state.wantedId, wantedId: null };
      }
      const keep = state.selectedId && sessions.some((s) => s.id === state.selectedId);
      return { sessions, selectedId: keep ? state.selectedId : (sessions[0]?.id ?? null) };
    }),
  select: (id) => {
    writeSelected(id);
    set((state) =>
      state.sessions.some((s) => s.id === id) ? { selectedId: id, wantedId: null } : { wantedId: id },
    );
  },
  setBroadcast: (broadcast) => set({ broadcast }),
  setDraft: (sessionId, text) => set((state) => ({ drafts: { ...state.drafts, [sessionId]: text } })),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  setRenaming: (renamingId) => set({ renamingId }),
}));
