import { bearing, pointAtDistance } from "@/lib/route-projection";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { EPOCH, MINUTE, SIMULATED, SIMULATION_SOURCE, seededRandom, timestamp } from "./clock";
import { busRoutes, railRoutes, stationServices, type SimulatedRoute } from "./network";

function makeFleet(route: SimulatedRoute) {
  const random = seededRandom(route.seed);
  return Array.from({ length: route.fleetSize }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return {
      id: `${route.mode === "Bus" ? "bus" : "train"}:${route.id}:${number}`,
      name: `${route.mode === "Bus" ? "Bus" : "Train"} ${route.id}-${number}`,
      route,
      phase: Math.round((index + random() * .6) * route.period / route.fleetSize),
      offset: route.mode === "Bus" ? [-3, 0, 4][Math.floor(random() * 3)] * MINUTE : 0,
    };
  });
}

const fleetByRoute = new Map([...busRoutes, ...railRoutes].map(route => [route.id, makeFleet(route)]));
const fleet = [...fleetByRoute.values()].flat();
const vehicleById = new Map(fleet.map(vehicle => [vehicle.id, vehicle]));
type Vehicle = typeof fleet[number];
type Direction = 0 | 1;
const directions = [0, 1] as const;

function trip(vehicle: Vehicle, cycleStart: number, direction: Direction) {
  const start = cycleStart + (direction === 1 ? vehicle.route.legs[0].duration : 0);
  return { id: `${vehicle.id}:${start}:${direction}`, start, direction, leg: vehicle.route.legs[direction] };
}

function cycleStart(vehicle: Vehicle, now: number) {
  const origin = EPOCH - vehicle.phase + vehicle.offset;
  return origin + Math.floor((now - origin) / vehicle.route.period) * vehicle.route.period;
}

function currentTrip(vehicle: Vehicle, now: number) {
  const start = cycleStart(vehicle, now);
  return trip(vehicle, start, now - start < vehicle.route.legs[0].duration ? 0 : 1);
}

function locate(vehicle: Vehicle, now: number) {
  const run = currentTrip(vehicle, now);
  const elapsed = now - run.start;
  let index = 0;
  while (index + 1 < run.leg.stops.length && run.leg.stops[index + 1].arrival <= elapsed) index++;
  const lastReached = run.leg.stops[index];
  const next = run.leg.stops[index + 1] ?? null;
  const atStop = elapsed < lastReached.departure || !next;
  const distance = atStop ? lastReached.distance : lastReached.distance +
    (next.distance - lastReached.distance) * (elapsed - lastReached.departure) / (next.arrival - lastReached.departure);
  const { point, segment } = pointAtDistance(run.leg.shape, distance);
  const path = run.leg.shape.path;
  const record: TransitRecord = {
    id: vehicle.id, name: vehicle.name, mode: vehicle.route.mode, operator: vehicle.route.operator,
    route: vehicle.route.mode === "Bus" ? vehicle.route.id : vehicle.route.name, routeId: vehicle.route.id,
    tripId: run.id, station: atStop ? lastReached.name : null, position: point, recordKind: "vehicle",
    bearing: Math.round(bearing(path[segment], path[segment + 1])), speed: atStop ? 0 : vehicle.route.speedKmh,
    nextScheduledAt: next ? timestamp(run.start + next.arrival) : null,
    railLines: vehicle.route.mode === "Bus" ? undefined : [vehicle.route.id],
    reportedAt: timestamp(now), lastUpdatedAt: timestamp(now), status: atStop ? "At stop" : "In service",
    dataMode: SIMULATED, source: SIMULATION_SOURCE,
  };
  return { record, run, index, next, atStop, lastReached, segment, distance };
}

export function busRecords(now: number) {
  return fleet.filter(vehicle => vehicle.route.mode === "Bus").map(vehicle => locate(vehicle, now).record);
}

export function trainPositions(now: number) {
  return fleet.filter(vehicle => vehicle.route.mode !== "Bus").map(vehicle => {
    const { record, run, index, next, lastReached, atStop } = locate(vehicle, now);
    return {
      ...record, position: record.position!, lineId: vehicle.route.id, lineName: vehicle.route.name, colour: vehicle.route.colour,
      direction: run.direction, destination: run.leg.stops.at(-1)!.name,
      nearStation: atStop ? lastReached : null, previousStation: atStop ? run.leg.stops[index - 1] ?? null : lastReached,
      nextStation: next, nextArrival: next ? run.start + next.arrival : null, updatedAt: timestamp(now),
    };
  });
}
export type SimulatedTrain = ReturnType<typeof trainPositions>[number];

export type SimulatedArrival = {
  tripId: string;
  vehicleId: string;
  routeId: string;
  routeName: string;
  mode: TransitRecord["mode"];
  destination: string;
  platform: string;
  arrivalTimestamp: number;
  departureTimestamp: number;
  dataMode: typeof SIMULATED;
};

function upcomingVisits(refs: string[], now: number, atOrigin = false): SimulatedArrival[] {
  const arrivals = new Map<string, SimulatedArrival>();
  for (const ref of refs) {
    const service = stationServices.get(ref);
    if (!service) continue;
    const { route, station } = service;
    for (const vehicle of fleetByRoute.get(route.id)!) {
      const firstCycle = cycleStart(vehicle, now);
      const cycles = 1 + Math.ceil(8 / route.fleetSize);
      for (let cycle = 0; cycle < cycles; cycle++) {
        for (const direction of directions) {
          const run = trip(vehicle, firstCycle + cycle * route.period, direction);
          const index = run.leg.stops.findIndex(candidate => candidate.id === station.id);
          const visit = run.leg.stops[index];
          // Each terminal turn is one stop visit. The journey preview uses the origin of the next leg.
          if (!visit || (atOrigin ? index !== 0 : index === 0) || run.start + visit.arrival < now) continue;
          const terminal = index === run.leg.stops.length - 1;
          const destination = terminal ? run.leg.stops[0].name : run.leg.stops.at(-1)!.name;
          const departure = visit.departure + (terminal ? route.legs[direction === 0 ? 1 : 0].stops[0].departure : 0);
          arrivals.set(`${run.id}:${station.id}`, {
            tripId: run.id, vehicleId: vehicle.id, routeId: route.id, routeName: route.mode === "Bus" ? route.id : route.name,
            mode: route.mode, destination, platform: String((terminal ? 1 - direction : direction) + 1),
            arrivalTimestamp: run.start + visit.arrival, departureTimestamp: run.start + departure, dataMode: SIMULATED,
          });
        }
      }
    }
  }
  return [...arrivals.values()].sort((a, b) => a.arrivalTimestamp - b.arrivalTimestamp || a.tripId.localeCompare(b.tripId)).slice(0, 8);
}

export function stationArrivals(refs: string[], now: number) {
  return upcomingVisits(refs, now);
}

export function busJourney(vehicleId: string, now: number, previewVehicle?: string, departureStart?: number) {
  const vehicle = vehicleById.get(vehicleId);
  if (!vehicle || vehicle.route.mode !== "Bus") return null;
  const { record, run, index, next, atStop, segment, distance } = locate(vehicle, now);
  const preview = previewVehicle ? vehicleById.get(previewVehicle) : undefined;
  const candidate = preview?.route === vehicle.route && departureStart !== undefined && Number.isSafeInteger(departureStart) &&
    Math.abs(departureStart - now) < vehicle.route.period ? currentTrip(preview, departureStart) : null;
  const selectedRun = candidate && candidate.start === departureStart ? candidate : run;
  const isPreview = selectedRun.id !== run.id;
  const stops = selectedRun.leg.stops.map((stop, stopIndex) => ({
    id: stop.id, sequence: stopIndex + 1, name: stop.name, position: stop.position,
    arrival: timestamp(selectedRun.start + stop.arrival), departure: timestamp(selectedRun.start + stop.departure),
    scheduledDeparture: timestamp(selectedRun.start + stop.departure - (isPreview && preview ? preview.offset : vehicle.offset)),
    classification: SIMULATED,
    status: isPreview ? "UPCOMING" as const : stopIndex < index || stopIndex === index && !atStop ? "PASSED" as const :
      stopIndex === index ? "CURRENT" as const : "UPCOMING" as const,
  }));
  const route = vehicle.route;
  const upcoming = upcomingVisits(directions.map(direction => `sim:${route.id}:${route.legs[direction].stops[0].id}`), now, true);
  return {
    vehicle: record, dataMode: SIMULATED, now, position: record.position!, routeId: route.id, routeName: route.name,
    direction: selectedRun.direction, origin: selectedRun.leg.stops[0].name, destination: selectedRun.leg.stops.at(-1)!.name,
    journeyId: selectedRun.id, currentJourneyId: run.id, isPreview, stops, path: selectedRun.leg.shape.path,
    segment, progress: distance / run.leg.shape.lengthM, currentDeparture: timestamp(run.start + run.leg.stops[0].departure),
    timing: vehicle.offset < 0 ? "Early" : vehicle.offset > 0 ? "Delayed" : "On time",
    offsetMinutes: vehicle.offset / MINUTE, nextStop: next?.name ?? null, nextArrival: next ? run.start + next.arrival : null,
    departures: upcoming.filter(arrival => arrival.tripId !== run.id),
  };
}
export type SimulatedBusJourney = NonNullable<ReturnType<typeof busJourney>>;
