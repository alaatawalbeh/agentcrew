import type { Status } from '@shared/types';
import { FACE_STATE } from './faceState';
import { defineRobotFace, type FaceState } from './robotFaceElement';
import type { Robot } from './roster';

defineRobotFace();

/** A robot's animated face, in its colour, showing its status (see design/robot-face.js). */
export function RobotFace({ robot, size, status, face }: { robot: Robot; size: number; status: Status; face?: FaceState }) {
  return <robot-face class="face" state={face ?? FACE_STATE[status]} hue={robot.accent} size={size} />;
}
