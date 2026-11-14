// Every robot in every state, side by side: the browser preview's ?scenario=faces (npm run dev:web). Handy for
// tuning the faces in personality.ts and robotFaceElement.ts. Not part of the desktop app's window.
import { ROSTER_ROBOTS } from '@shared/crew';
import { STATUS_LABEL, type Status } from '@shared/types';
import { RobotFace } from './RobotFace';
import { robotFor } from './roster';

const STATUSES = Object.keys(STATUS_LABEL) as Status[];

export function FaceGallery() {
  return (
    <main className="gallery">
      <h1 className="gallery-title">The crew's faces</h1>
      <table className="gallery-grid">
        <thead>
          <tr>
            <th />
            {STATUSES.map((status) => (
              <th key={status} scope="col">
                {STATUS_LABEL[status]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROSTER_ROBOTS.map(({ id }) => {
            const robot = robotFor(id);
            return (
              <tr key={id}>
                <th scope="row">{robot.name}</th>
                {STATUSES.map((status) => (
                  <td key={status}>
                    <RobotFace robot={robot} size={64} status={status} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
