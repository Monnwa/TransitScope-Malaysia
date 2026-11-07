import type { VehicleObservation } from "@/lib/transit-data";

// Protobuf defaults live on prototypes. Presence must be tested before reading
// fields: an omitted current_stop_sequence must never become a reported zero.
export function vehicleObservation(vehicle: any): VehicleObservation {
  const has = (object: object | null | undefined, key: string) => !!object && Object.prototype.hasOwnProperty.call(object,key);
  const trip=vehicle.trip;
  const sequence=has(vehicle,"currentStopSequence")?Number(vehicle.currentStopSequence):undefined;
  const status=has(vehicle,"currentStatus")?Number(vehicle.currentStatus):2; // GTFS default, only meaningful with a sequence.
  const seconds=has(vehicle,"timestamp")?Number(vehicle.timestamp):NaN;
  return {
    ...(has(trip,"startTime")&&trip.startTime?{tripStartTime:trip.startTime}:{}),
    ...(has(trip,"startDate")&&trip.startDate?{tripStartDate:trip.startDate}:{}),
    ...(has(trip,"directionId")?{directionId:String(trip.directionId)}:{}),
    ...(Number.isFinite(seconds)&&seconds>0&&seconds<8640000000000?{positionTimestamp:new Date(seconds*1000).toISOString()}:{}),
    ...(Number.isInteger(sequence)&&sequence!>=0?{currentStopSequence:sequence,currentStatus:(["INCOMING_AT","STOPPED_AT","IN_TRANSIT_TO"] as const)[status]}:{}),
    ...(has(vehicle,"stopId")&&vehicle.stopId?{stopId:vehicle.stopId}:{}),
    ...(has(trip,"scheduleRelationship")?{scheduleRelationship:Number(trip.scheduleRelationship)}:{})
  };
}
