import { busRoutes } from "@/lib/simulation/network";
import type { GeoPoint } from "@/lib/route-projection";
import { brtSunway } from "@/lib/expanded-services";

// Explicit regional scope for the existing fixtures. Do not pull future Penang routes
// into the Klang Valley view merely because they are also simulated buses.
const klangValleyRouteIds = new Set(["T401", "T402"]);
export const busMapRoutes = busRoutes.filter(route => klangValleyRouteIds.has(route.id)).map(route => ({
  id: route.id,
  name: route.name,
  // Join the existing internal legs at their shared endpoint, once at module load.
  // These legs are simulation segments, not published independent route directions.
  path: route.legs.flatMap((leg, index) => index ? leg.shape.path.slice(1) : leg.shape.path),
}));
export const busNetworkPath: GeoPoint[] = busMapRoutes.flatMap(route => route.path);

export function busRouteViewport(routeId: string): GeoPoint[] {
  if (routeId === brtSunway.id) return brtSunway.paths[0];
  return busMapRoutes.find(route => route.id === routeId)?.path ?? busNetworkPath;
}
