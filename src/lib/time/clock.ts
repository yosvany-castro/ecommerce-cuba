export interface Clock {
  now(): number;
}

export interface FixedClock extends Clock {
  advance(ms: number): void;
  set(ts: number | Date): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

export function fixedClock(initial: number | Date): FixedClock {
  let t = typeof initial === "number" ? initial : initial.getTime();
  return {
    now: () => t,
    advance: (ms) => { t += ms; },
    set: (ts) => { t = typeof ts === "number" ? ts : ts.getTime(); },
  };
}
