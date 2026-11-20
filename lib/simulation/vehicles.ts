import { bearing, indexShape, pointAtDistance, projectCandidates } from "@/lib/route-projection";
import { railMapPaths } from "@/lib/rail-map-geometry";
import { publishedRailStops } from "@/lib/rail-station-coordinates";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { EPOCH, MINUTE, SIMULATED, SIMULATION_SOURCE, seededRandom, timestamp } from "./clock";
import { busRoutes, railNetwork, railRoutes, stationServices, type SimulatedRoute } from "./network";
import { brtSunway } from "@/lib/expanded-services";

const routeLabel = (route: SimulatedRoute) => route.mode === "Bus" && route.id !== brtSunway.id ? route.id : route.name;

// Keep simulation timings on the original legs and use one displayed alignment in both directions.
const trainTracks = new Map(railNetwork.lines.map(line => {
  const route = railRoutes.find(route => route.id === line.id)!;
  const paths = railMapPaths(line);
  const shape = paths.length === 1 ? indexShape(paths[0]) : null;
  if (!shape) throw new Error(`Invalid displayed track for ${line.id}`);

  const outbound: number[] = [];
  for (const stop of route.stops) {
    const position = publishedRailStops[`sim:${line.id}:${stop.id}`]?.position ?? stop.position;
    const match = projectCandidates(shape, position, 250)
      .reduce<ReturnType<typeof projectCandidates>[number] | undefined>(
        (nearest, candidate) => !nearest || candidate.offsetM < nearest.offsetM ? candidate : nearest, undefined);
    if (!match || match.distanceM <= (outbound.at(-1) ?? -1)) {
      throw new Error(`Invalid displayed track position for ${line.id} at ${stop.name}`);
    }
    outbound.push(match.distanceM);
  }
  return [line.id, { shape, stopDistances: [outbound, [...outbound].reverse()] }];
}));

function makeFleet(route: SimulatedRoute) {
  const random = seededRandom(route.seed);
  return Array.from({ length: route.fleetSize }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return {
      id: `${route.mode === "Bus" ? "bus" : "train"}:${route.id}:${number}`,
      name: `${route.mode === "Bus" ? "Bus" : "Train"} ${route.id}-${number}`,
      route,
      phase: Math.round((index + (route.mode === "Bus" ? 0 : random() * .6)) * route.period / route.fleetSize),
      offset: 0,
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
  const track = trainTracks.get(vehicle.route.id);
  const shape = track?.shape ?? run.leg.shape;
  const stopDistances = track?.stopDistances[run.direction];
  const from = stopDistances?.[index] ?? lastReached.distance;
  const to = stopDistances?.[index + 1] ?? next?.distance ?? from;
  const distance = atStop ? from : from +
    (to - from) * (elapsed - lastReached.departure) / (next.arrival - lastReached.departure);
  const { point, segment } = pointAtDistance(shape, distance);
  const reverse = track && run.direction === 1;
  const heading = reverse ? bearing(shape.path[segment + 1], shape.path[segment]) : bearing(shape.path[segment], shape.path[segment + 1]);
  const speed = atStop ? 0 : vehicle.route.mode === "Bus" && next
    ? Math.round((next.distance - lastReached.distance) * 3_600 / (next.arrival - lastReached.departure))
    : vehicle.route.speedKmh;
  const record: TransitRecord = {
    id: vehicle.id, name: vehicle.name, mode: vehicle.route.mode, operator: vehicle.route.operator,
    route: routeLabel(vehicle.route), routeId: vehicle.route.id,
    tripId: run.id, station: atStop ? lastReached.name : null, position: point, recordKind: "vehicle",
    bearing: Math.round(heading), speed,
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

function visitCycles(route: SimulatedRoute) {
  return 1 + Math.ceil(8 / route.fleetSize);
}

function boardTime(visit: SimulatedArrival) {
  return visit.mode === "Bus" ? visit.departureTimestamp : visit.arrivalTimestamp;
}

function upcomingVisits(refs: string[], now: number, atOrigin = false): SimulatedArrival[] {
  const arrivals = new Map<string, SimulatedArrival>();
  for (const ref of refs) {
    const service = stationServices.get(ref);
    if (!service) continue;
    const { route, station } = service;
    for (const vehicle of fleetByRoute.get(route.id)!) {
      const firstCycle = cycleStart(vehicle, now);
      const cycles = visitCycles(route);
      // A bus origin departure at the cycle seam belongs to the just-ended return leg.
      const startCycle = route.mode === "Bus" && !atOrigin ? -1 : 0;
      for (let cycle = startCycle; cycle < cycles; cycle++) {
        for (const direction of directions) {
          const run = trip(vehicle, firstCycle + cycle * route.period, direction);
          const index = run.leg.stops.findIndex(candidate => candidate.id === station.id);
          const visit = run.leg.stops[index];
          // Each terminal turn is one stop visit. The journey preview uses the origin of the next leg.
          if (!visit || (atOrigin ? index !== 0 : index === 0)) continue;
          const terminal = index === run.leg.stops.length - 1;
          const destination = terminal ? run.leg.stops[0].name : run.leg.stops.at(-1)!.name;
          const departure = visit.departure + (terminal ? route.legs[direction === 0 ? 1 : 0].stops[0].departure : 0);
          const upcomingTime = route.mode === "Bus" && !atOrigin ? departure : visit.arrival;
          if (run.start + upcomingTime < now) continue;
          arrivals.set(`${run.id}:${station.id}`, {
            tripId: run.id, vehicleId: vehicle.id, routeId: route.id, routeName: routeLabel(route),
            mode: route.mode, destination, platform: String((terminal ? 1 - direction : direction) + 1),
            arrivalTimestamp: run.start + visit.arrival, departureTimestamp: run.start + departure, dataMode: SIMULATED,
          });
        }
      }
    }
  }
  return [...arrivals.values()].sort((a, b) => boardTime(a) - boardTime(b) || a.tripId.localeCompare(b.tripId)).slice(0, 8);
}

export function stationArrivals(refs: string[], now: number) {
  return upcomingVisits(refs, now);
}

export function busJourney(vehicleId: string, now: number, previewVehicle?: string, departureStart?: number) {
  const vehicle = vehicleById.get(vehicleId);
  if (!vehicle || vehicle.route.mode !== "Bus") return null;
  const { record, run, index, next, atStop, segment, distance } = locate(vehicle, now);
  const route = vehicle.route;
  const departures = upcomingVisits(directions.map(direction => "sim:" + route.id + ":" + route.legs[direction].stops[0].id), now, true)
    .filter(arrival => arrival.tripId !== run.id);
  const option = departures.find(arrival => arrival.vehicleId === previewVehicle && arrival.arrivalTimestamp === departureStart);
  const preview = option ? vehicleById.get(option.vehicleId) : undefined;
  const selectedRun = preview && option ? currentTrip(preview, option.arrivalTimestamp) : run;
  const isPreview = option !== undefined;
  const stops = selectedRun.leg.stops.map((stop, stopIndex) => ({
    id: stop.id, sequence: stopIndex + 1, name: stop.name, position: stop.position,
    arrival: timestamp(selectedRun.start + stop.arrival), departure: timestamp(selectedRun.start + stop.departure),
    scheduledDeparture: timestamp(selectedRun.start + stop.departure - (isPreview && preview ? preview.offset : vehicle.offset)),
    classification: SIMULATED,
    status: isPreview ? "UPCOMING" as const : stopIndex < index || stopIndex === index && !atStop ? "PASSED" as const :
      stopIndex === index ? "CURRENT" as const : "UPCOMING" as const,
  }));
  return {
    vehicle: record, dataMode: SIMULATED, now, position: record.position!, routeId: route.id, routeName: route.name,
    direction: selectedRun.direction, origin: selectedRun.leg.stops[0].name, destination: selectedRun.leg.stops.at(-1)!.name,
    journeyId: selectedRun.id, currentJourneyId: run.id, isPreview, stops, path: selectedRun.leg.shape.path,
    segment, progress: distance / run.leg.shape.lengthM, currentDeparture: timestamp(run.start + run.leg.stops[0].departure),
    timing: vehicle.offset < 0 ? "Early" : vehicle.offset > 0 ? "Delayed" : "On time",
    offsetMinutes: vehicle.offset / MINUTE, nextStop: next?.name ?? null, nextArrival: next ? run.start + next.arrival : null,
    departures,
  };
}
export type SimulatedBusJourney = NonNullable<ReturnType<typeof busJourney>>;
