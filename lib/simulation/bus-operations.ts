import { MINUTE } from "./clock";

export const busOperationalTiming = {
  T401: { headwayMs: 30 * MINUTE, originLayoverMs: 5 * MINUTE },
  T402: { headwayMs: 30 * MINUTE, originLayoverMs: 10 * MINUTE },
} as const;

export const busStopDwellMs = 15_000;
export const busSpeedLimitKmh = 45;

/** Preserve the reference time budget while giving every span enough time at the simulation speed cap. */
export function busRunningTimes(stops: readonly { distance: number; elapsedMs: number }[], originDwellMs: number) {
  const intervals = stops.slice(1).map((stop, index) => {
    const previous = stops[index];
    const dwell = index === 0 ? originDwellMs : busStopDwellMs;
    return {
      requested: stop.elapsedMs - previous.elapsedMs - dwell,
      minimum: Math.ceil((stop.distance - previous.distance) / (busSpeedLimitKmh / 3.6) * 1_000),
    };
  });
  const total = intervals.reduce((sum, time) => sum + time.requested, 0);
  const minimum = intervals.reduce((sum, time) => sum + time.minimum, 0);
  if (!intervals.length || intervals.some(time => time.requested <= 0 || time.minimum <= 0) || total < minimum) {
    throw new Error("Invalid simulated bus running time budget");
  }

  const surplus = (time: typeof intervals[number]) => Math.max(0, time.requested - time.minimum);
  const weight = intervals.reduce((sum, time) => sum + surplus(time), 0);
  let allocatedWeight = 0;
  let allocatedTime = 0;
  return intervals.map(time => {
    allocatedWeight += surplus(time);
    const cumulativeTime = weight ? Math.round((total - minimum) * allocatedWeight / weight) : 0;
    const runningTime = time.minimum + cumulativeTime - allocatedTime;
    allocatedTime = cumulativeTime;
    return runningTime;
  });
}

export function scheduleBusLeg<Stop extends { distance: number }>(
  stops: readonly Stop[],
  runningTimes: readonly number[],
  terminalDwellMs: number,
) {
  if (stops.length < 2 || runningTimes.length !== stops.length - 1 ||
      runningTimes.some(time => !Number.isSafeInteger(time) || time <= 0) ||
      !Number.isSafeInteger(terminalDwellMs) || terminalDwellMs < 0) {
    throw new Error("Invalid simulated bus operational timing");
  }

  let departure = 0;
  return stops.map((stop, index) => {
    const arrival = index === 0 ? 0 : departure + runningTimes[index - 1];
    const dwell = index === 0 ? 0 : index === stops.length - 1 ? terminalDwellMs : busStopDwellMs;
    departure = arrival + dwell;
    return { ...stop, arrival, departure };
  });
}
