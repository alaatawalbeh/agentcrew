// Each robot's own look and manner for its animated face: head shape, eyes, mouth, what it wears on its head, how it
// thinks, sleeps, celebrates, asks for you and breaks down, and the little fidgets it does while it waits. The six
// robots from the design differ in every one of these.

export type EyeStyle = 'tall' | 'dot' | 'wide' | 'sleepy' | 'googly' | 'visor' | 'cyclops';
export type MouthStyle = 'bars' | 'oval' | 'wave' | 'grill';
export type ThinkStyle = 'orbit' | 'bubbles' | 'scan' | 'sonar' | 'ellipsis';
export type SleepStyle = 'zzz' | 'bubble' | 'nod' | 'stars';
export type DoneStyle = 'sparkles' | 'confetti' | 'hop' | 'heart';
export type AlertStyle = 'bang' | 'question' | 'bounce' | 'siren';
export type ErrorStyle = 'glitch' | 'smoke' | 'dizzy';
export type Accessory = 'none' | 'antenna' | 'twin' | 'ears' | 'bolts' | 'halo' | 'crest' | 'sprout';
export type Fidget = 'glance' | 'hop' | 'wink' | 'wiggle' | 'look-up';

export interface Personality {
  /** Head outline: 2 is round, above 2 boxier (a TV head), below 2 pointier. */
  shape: number;
  /** Width and height stretch of the head. */
  aspect: readonly [number, number];
  /** The two ripples that make the head wobble (how many bumps go round it). */
  lobes: readonly [number, number];
  /** How much the head wobbles. */
  wobble: number;
  /** Speed of everything it does: calm robots below 1, lively ones above. */
  tempo: number;
  eyes: EyeStyle;
  /** Milliseconds between blinks, and whether it sometimes blinks twice. */
  blinkEvery: readonly [number, number];
  doubleBlink: boolean;
  mouth: MouthStyle;
  think: ThinkStyle;
  sleep: SleepStyle;
  done: DoneStyle;
  alert: AlertStyle;
  error: ErrorStyle;
  accessory: Accessory;
  fidgets: readonly Fidget[];
  /** Seconds between fidgets. */
  fidgetEvery: readonly [number, number];
  /** How keenly its eyes follow the pointer (0 ignores it). */
  curiosity: number;
}

const BASE: Personality = {
  shape: 2,
  aspect: [1, 1],
  lobes: [3, 5],
  wobble: 1,
  tempo: 1,
  eyes: 'tall',
  blinkEvery: [2200, 5700],
  doubleBlink: false,
  mouth: 'bars',
  think: 'orbit',
  sleep: 'zzz',
  done: 'sparkles',
  alert: 'bang',
  error: 'glitch',
  accessory: 'none',
  fidgets: ['glance'],
  fidgetEvery: [5, 11],
  curiosity: 1,
};

export const PERSONALITIES: Readonly<Record<string, Personality>> = {
  // The steady lead: the design's original face, with an antenna.
  atlas: { ...BASE, accessory: 'antenna', fidgets: ['glance', 'look-up'] },
  // A boxy TV head with a visor and a speaker grill, sweeping a scan line while it thinks.
  vega: {
    ...BASE,
    shape: 3.4,
    lobes: [4, 8],
    wobble: 0.55,
    eyes: 'visor',
    mouth: 'grill',
    think: 'scan',
    sleep: 'nod',
    done: 'confetti',
    alert: 'siren',
    error: 'smoke',
    accessory: 'bolts',
    fidgets: ['wiggle', 'glance'],
    blinkEvery: [3500, 7000],
  },
  // Tall, calm and round-eyed: thinks in bubbles, blows a bubble in its sleep.
  orin: {
    ...BASE,
    aspect: [0.9, 1.1],
    lobes: [2, 4],
    tempo: 0.8,
    eyes: 'googly',
    mouth: 'oval',
    think: 'bubbles',
    sleep: 'bubble',
    done: 'heart',
    alert: 'question',
    error: 'dizzy',
    accessory: 'ears',
    fidgets: ['look-up', 'glance'],
    fidgetEvery: [6, 13],
    curiosity: 1.2,
  },
  // Spiky and full of energy: hops when it's done, bounces when it needs you.
  nova: {
    ...BASE,
    shape: 1.7,
    lobes: [5, 8],
    wobble: 1.35,
    tempo: 1.3,
    eyes: 'wide',
    mouth: 'wave',
    think: 'sonar',
    sleep: 'stars',
    done: 'hop',
    alert: 'bounce',
    accessory: 'crest',
    fidgets: ['hop', 'wiggle', 'glance'],
    fidgetEvery: [3, 7],
    blinkEvery: [1500, 3800],
    doubleBlink: true,
  },
  // Small and squat with two antennae and button eyes: types "…" while it thinks.
  kit: {
    ...BASE,
    shape: 2.4,
    aspect: [1.14, 0.88],
    tempo: 1.15,
    eyes: 'dot',
    think: 'ellipsis',
    done: 'hop',
    error: 'smoke',
    accessory: 'twin',
    fidgets: ['wink', 'hop'],
    fidgetEvery: [4, 9],
    doubleBlink: true,
  },
  // Slow and dreamy, with heavy eyelids and a halo.
  sable: {
    ...BASE,
    lobes: [2, 3],
    wobble: 0.7,
    tempo: 0.7,
    eyes: 'sleepy',
    mouth: 'oval',
    sleep: 'nod',
    done: 'heart',
    alert: 'question',
    error: 'dizzy',
    accessory: 'halo',
    fidgets: ['look-up'],
    fidgetEvery: [8, 16],
    blinkEvery: [3000, 7500],
    curiosity: 0.6,
  },
  // One big eye, always watching.
  juno: {
    ...BASE,
    shape: 2.2,
    aspect: [1, 1.05],
    lobes: [3, 7],
    eyes: 'cyclops',
    mouth: 'wave',
    think: 'sonar',
    sleep: 'bubble',
    done: 'confetti',
    alert: 'siren',
    accessory: 'antenna',
    fidgets: ['glance', 'wiggle'],
    curiosity: 1.3,
  },
  // A sturdy block with ears: scans while it thinks.
  rook: {
    ...BASE,
    shape: 3.8,
    lobes: [4, 6],
    wobble: 0.45,
    tempo: 0.9,
    eyes: 'tall',
    mouth: 'grill',
    think: 'scan',
    alert: 'bounce',
    error: 'smoke',
    accessory: 'ears',
    fidgets: ['wiggle'],
    fidgetEvery: [6, 12],
  },
  // Bubbly and sweet: googly eyes, hearts, and stars in its sleep.
  lyra: {
    ...BASE,
    lobes: [4, 6],
    tempo: 1.1,
    eyes: 'googly',
    mouth: 'oval',
    think: 'bubbles',
    sleep: 'stars',
    done: 'heart',
    alert: 'question',
    error: 'dizzy',
    accessory: 'crest',
    fidgets: ['wink', 'hop', 'glance'],
    fidgetEvery: [4, 9],
  },
  // A leafy sprout: gentle, sways a little.
  fern: {
    ...BASE,
    shape: 1.85,
    aspect: [0.92, 1.08],
    lobes: [2, 7],
    tempo: 0.85,
    eyes: 'dot',
    mouth: 'wave',
    think: 'ellipsis',
    sleep: 'bubble',
    done: 'confetti',
    error: 'smoke',
    accessory: 'sprout',
    fidgets: ['look-up', 'wiggle'],
  },
  // Sharp and quick, with a visor and a halo.
  ion: {
    ...BASE,
    shape: 1.6,
    lobes: [3, 6],
    tempo: 1.25,
    eyes: 'visor',
    think: 'orbit',
    sleep: 'nod',
    done: 'sparkles',
    alert: 'siren',
    accessory: 'halo',
    fidgets: ['glance'],
    fidgetEvery: [3, 8],
  },
  // Wide and friendly, with bolts on its sides.
  tess: {
    ...BASE,
    shape: 2.8,
    aspect: [1.1, 0.92],
    eyes: 'wide',
    mouth: 'grill',
    think: 'ellipsis',
    sleep: 'stars',
    done: 'hop',
    alert: 'bounce',
    error: 'dizzy',
    accessory: 'bolts',
    fidgets: ['wink', 'glance'],
  },
};

export function personalityFor(robotId: string | null | undefined): Personality {
  return (robotId && PERSONALITIES[robotId]) || BASE;
}
