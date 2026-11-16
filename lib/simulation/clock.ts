export const SIMULATED = "SIMULATED" as const;
export const SIMULATION_SOURCE = "TransitScope simulation";
export const SIMULATION_TICK_MS = 5_000;
export const MINUTE = 60_000;
export const EPOCH = Date.UTC(2026, 0, 1);

export function simulationTime(time = Date.now()) {
  return Math.floor(time / SIMULATION_TICK_MS) * SIMULATION_TICK_MS;
}

export const timestamp = (time: number) => new Date(time).toISOString();

export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
