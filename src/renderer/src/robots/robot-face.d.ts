import 'react';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'robot-face': {
        class?: string;
        state?: string;
        hue?: string;
        size?: number | string;
        /** The robot's id: picks its personality. */
        robot?: string;
      };
    }
  }
}
