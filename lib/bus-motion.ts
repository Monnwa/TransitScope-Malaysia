import { PROGRESS_LIMITS } from "@/lib/route-projection";
import type { VehicleProgress } from "@/lib/vehicle-progress";

export const BUS_MOTION_LIMITS = {
  minObservations: 3, minSpanMs: 30000, minIntervalMs: 15000,
  maxIntervalMs: 60000, maxHistoryMs: 120000, minMovementM: 60,
  minSpeedMps: 1, maxSpeedMps: 25, maxRelativeDispersion: .5,
  maxEtaAgeMs: 45000, minEtaDistanceM: 25, maxEtaDistanceM: 1000, maxEtaSeconds: 600
} as const;
export type SpeedSample = {
  timestamp: number; distanceM: number; rawDistanceM: number;
  offsetM: number; accuracyM: number | null;
};
export type HistoricalSpeed = {
  basis: "ACCEPTED_GPS_HISTORY"; speedMps: number; lowMps: number; highMps: number;
  observationCount: number; spanMs: number; movementM: number;
  firstMeasuredAt: number; lastMeasuredAt: number; relativeDispersion: number;
  scope?: string;
};
export function busMotionScope(context:{key:string;historyToken:string;vehicleId:string;tripId:string;routeId?:string|null;shapeId:string|null;serviceDate:string;directionId?:string|null}) {
  return JSON.stringify([context.key,context.historyToken,context.vehicleId,context.tripId,context.routeId??null,context.shapeId,context.serviceDate,context.directionId??null]);
}
export type BusArrivalEstimate = {
  status: "ESTIMATED"; basis: "RECENT_GPS_MOVEMENT"; stopId: string; sequence: number;
  stopName: string; arrivalAt: number; earliestAt: number; latestAt: number;
  measuredAt: number; expiresAt: number; remainingDistanceM: number;
};
const median = (values: number[]) => {
  const sorted = [...values].sort((a,b)=>a-b), middle = Math.floor(sorted.length/2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
};

/** Original measured distances only; never animation frames or timetable speeds. */
export function historicalBusSpeed(samples: SpeedSample[], now: number): HistoricalSpeed | null {
  if (!Number.isFinite(now)||samples.some(sample=>!Number.isFinite(sample.timestamp))) return null;
  const recent = samples.filter(sample=>now-sample.timestamp<=BUS_MOTION_LIMITS.maxHistoryMs);
  if (recent.length<BUS_MOTION_LIMITS.minObservations) return null;
  const speeds: number[] = [];
  for (let i=0;i<recent.length;i++) {
    const sample=recent[i], previous=recent[i-1];
    if (![sample.timestamp,sample.distanceM,sample.rawDistanceM,sample.offsetM].every(Number.isFinite)
      || sample.timestamp>now || sample.offsetM<0 || sample.offsetM>PROGRESS_LIMITS.highRouteOffsetM
      || Math.abs(sample.distanceM-sample.rawDistanceM)>.05
      || sample.accuracyM!==null&&(!Number.isFinite(sample.accuracyM)||sample.accuracyM<0||sample.accuracyM>PROGRESS_LIMITS.highAccuracyM)) return null;
    if (!previous) continue;
    const dt=sample.timestamp-previous.timestamp, delta=sample.rawDistanceM-previous.rawDistanceM;
    if (dt<BUS_MOTION_LIMITS.minIntervalMs || dt>BUS_MOTION_LIMITS.maxIntervalMs || delta<2) return null;
    const speed=delta/(dt/1000);
    if (speed>BUS_MOTION_LIMITS.maxSpeedMps) return null;
    speeds.push(speed);
  }
  const first=recent[0],last=recent.at(-1)!,spanMs=last.timestamp-first.timestamp,movementM=last.rawDistanceM-first.rawDistanceM;
  if (spanMs<BUS_MOTION_LIMITS.minSpanMs||movementM<BUS_MOTION_LIMITS.minMovementM) return null;
  const speedMps=median(speeds),mad=median(speeds.map(speed=>Math.abs(speed-speedMps))),relativeDispersion=mad/speedMps;
  if (speedMps<BUS_MOTION_LIMITS.minSpeedMps||relativeDispersion>BUS_MOTION_LIMITS.maxRelativeDispersion||speeds.some(speed=>Math.abs(speed-speedMps)/speedMps>BUS_MOTION_LIMITS.maxRelativeDispersion)) return null;
  // A broad modelling range, not a statistically calibrated confidence interval.
  const spread=Math.max(speedMps*.25,1.4826*mad);
  return {basis:"ACCEPTED_GPS_HISTORY",speedMps,lowMps:Math.max(.5,speedMps-spread),highMps:Math.min(BUS_MOTION_LIMITS.maxSpeedMps,speedMps+spread),observationCount:recent.length,spanMs,movementM,firstMeasuredAt:first.timestamp,lastMeasuredAt:last.timestamp,relativeDispersion};
}

/** A short-horizon prediction; never an observed arrival or a scheduled clock. */
export function estimatedBusArrival(tracking: VehicleProgress | undefined, now: number): BusArrivalEstimate | null {
  const motion=tracking?.historicalSpeed,measuredAt=Date.parse(tracking?.vehicleTimestamp??"");
  if (!tracking||tracking.source!=="GPS_INFERRED"||tracking.confidence!=="HIGH"||tracking.distanceM===null
    || !motion||motion.basis!=="ACCEPTED_GPS_HISTORY"||motion.scope!==busMotionScope(tracking)||!Number.isFinite(now)||!Number.isFinite(measuredAt)
    || motion.lastMeasuredAt!==measuredAt||motion.observationCount<BUS_MOTION_LIMITS.minObservations
    || !Number.isInteger(motion.observationCount)||motion.observationCount>8
    || ![motion.speedMps,motion.lowMps,motion.highMps,motion.spanMs,motion.movementM,motion.firstMeasuredAt,motion.relativeDispersion].every(Number.isFinite)
    || motion.speedMps<BUS_MOTION_LIMITS.minSpeedMps||motion.speedMps>BUS_MOTION_LIMITS.maxSpeedMps
    || motion.highMps>BUS_MOTION_LIMITS.maxSpeedMps||motion.spanMs<BUS_MOTION_LIMITS.minSpanMs
    || motion.spanMs!==motion.lastMeasuredAt-motion.firstMeasuredAt||now-motion.firstMeasuredAt>BUS_MOTION_LIMITS.maxHistoryMs
    || motion.movementM<BUS_MOTION_LIMITS.minMovementM||motion.relativeDispersion<0||motion.relativeDispersion>BUS_MOTION_LIMITS.maxRelativeDispersion
    || motion.lowMps<=0||motion.lowMps>motion.speedMps||motion.highMps<motion.speedMps
    || now<measuredAt||now-measuredAt>=BUS_MOTION_LIMITS.maxEtaAgeMs) return null;
  const stop=tracking.stopProjections.find(stop=>stop.sequence===tracking.nextStopSequence);
  if (!stop||stop.confidence!=="HIGH"||stop.distanceM===null) return null;
  const remainingDistanceM=stop.distanceM-tracking.distanceM,seconds=remainingDistanceM/motion.speedMps;
  if (!Number.isFinite(seconds)||remainingDistanceM<=BUS_MOTION_LIMITS.minEtaDistanceM||remainingDistanceM>BUS_MOTION_LIMITS.maxEtaDistanceM||seconds>BUS_MOTION_LIMITS.maxEtaSeconds||remainingDistanceM/motion.lowMps>BUS_MOTION_LIMITS.maxEtaSeconds) return null;
  const arrivalAt=Math.round(measuredAt+seconds*1000),expiresAt=Math.min(measuredAt+BUS_MOTION_LIMITS.maxEtaAgeMs,motion.firstMeasuredAt+BUS_MOTION_LIMITS.maxHistoryMs,arrivalAt);
  if (now>=expiresAt) return null;
  return {status:"ESTIMATED",basis:"RECENT_GPS_MOVEMENT",stopId:stop.id,sequence:stop.sequence,stopName:stop.name,arrivalAt,earliestAt:Math.max(now,measuredAt+remainingDistanceM/motion.highMps*1000),latestAt:measuredAt+remainingDistanceM/motion.lowMps*1000,measuredAt,expiresAt,remainingDistanceM};
}

export function estimatedBusArrivalLabel(estimate: BusArrivalEstimate, now: number): string {
  const low=Math.max(1,Math.ceil((estimate.earliestAt-now)/60000)),high=Math.max(low,Math.ceil((estimate.latestAt-now)/60000));
  return low===high?`About ${low} min`:`About ${low}–${high} min`;
}
