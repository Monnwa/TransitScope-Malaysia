import { SIMULATED, simulationTime, timestamp } from "./clock";
import { busStops, railNetwork } from "./network";
import { bikeRecords, linkBikeSnapshot, simulationAlerts } from "./scenarios";
import { trainPositions, busRecords } from "./vehicles";

export function simulationSnapshot(now = simulationTime()) {
  const linkBike = linkBikeSnapshot(now);
  const trains = trainPositions(now);
  return {
    dataMode: SIMULATED, now, fetchedAt: timestamp(now), demo: true, feeds: [],
    records: [...busRecords(now), ...trains, ...busStops, ...railNetwork.stations, ...bikeRecords(linkBike.stations)],
    alerts: simulationAlerts(now), trains, linkBike,
  };
}
