import type { Status } from '@shared/types';
import type { FaceState } from './robotFaceElement';

/** How each robot status looks on its animated face. */
export const FACE_STATE: Readonly<Record<Status, FaceState>> = {
  sleeping: 'idle',
  paused: 'ready',
  thinking: 'thinking',
  speaking: 'speaking',
  'needs-approval': 'approval',
  stuck: 'error',
  done: 'done',
};
