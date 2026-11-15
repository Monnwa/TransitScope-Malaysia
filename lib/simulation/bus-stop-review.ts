import { distanceM, type GeoPoint } from "@/lib/route-projection";
import { SIMULATED } from "./clock";

const sourceRef = "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder";

export type BusStopReview = {
  routeId: string;
  stopId: string;
  name: string;
  position: GeoPoint;
  publishedPosition: GeoPoint;
  distanceFromPublishedM: number;
  confidence: "PUBLISHED_GTFS_STOP";
  verificationStatus: "BOARDING_BAY_UNVERIFIED";
  geometryStatus: "PROJECTED_ON_PUBLISHED_SHAPE";
  sourceRef: string;
  assessedOn: "2026-11-15";
  dataMode: typeof SIMULATED;
};

export function reviewBusStop(
  routeId: string,
  stop: { id: string; name: string; position: GeoPoint },
  publishedPosition: GeoPoint,
): BusStopReview {
  const distanceFromPublishedM = distanceM(stop.position, publishedPosition);
  if (!Number.isFinite(distanceFromPublishedM) || distanceFromPublishedM > 25) {
    throw new Error("Stop projection exceeds the review tolerance for " + routeId + ":" + stop.id);
  }
  return {
    routeId, stopId: stop.id, name: stop.name, position: stop.position, publishedPosition, distanceFromPublishedM,
    confidence: "PUBLISHED_GTFS_STOP", verificationStatus: "BOARDING_BAY_UNVERIFIED",
    geometryStatus: "PROJECTED_ON_PUBLISHED_SHAPE", sourceRef, assessedOn: "2026-11-15", dataMode: SIMULATED,
  };
}
