import type { Alert, Mode, Record as TransitRecord } from "@/lib/transit-data";
import { EPOCH, MINUTE, SIMULATED, SIMULATION_SOURCE, seededRandom, timestamp } from "./clock";

type AlertScenario = Pick<Alert, "id" | "title" | "description" | "severity" | "routes" | "stations"> & {
  category: "Disruption" | "Delay" | "Normal service" | "Restoration";
  routeIds: string[];
  modes: Mode[];
  age: number;
  direction?: string;
};

const scenarios: AlertScenario[] = [
  { id: "platform-closure", category: "Disruption", severity: "High", title: "Bandar Tasik Selatan platform access change",
    description: "The eastern platform entrance is closed for inspection. Follow signs to the western entrance to board Sri Petaling Line trains towards Putra Heights.",
    routes: ["LRT Sri Petaling Line"], routeIds: ["LRT-PH"], stations: ["Bandar Tasik Selatan"], modes: ["LRT"], direction: "Putra Heights", age: 12 },
  { id: "kajang-delay", category: "Delay", severity: "Medium", title: "Longer waits on the Kajang Line",
    description: "Allow up to five extra minutes at Bukit Bintang and Tun Razak Exchange during signal checks.",
    routes: ["MRT Kajang Line (MRT1)"], routeIds: ["MRT1"], stations: ["Bukit Bintang", "Tun Razak Exchange"], modes: ["MRT"], age: 8 },
  { id: "komuter-normal", category: "Normal service", severity: "Low", title: "KTM Komuter running normally",
    description: "Simulated Komuter services are running at their usual intervals.",
    routes: ["KTM Tanjung Malim–Port Klang", "KTM Batu Caves–Pulau Sebang"], routeIds: ["KTM:KA15_KD19", "KTM:KC05_KB18"], stations: [], modes: ["KTM"], age: 5 },
  { id: "bus-restoration", category: "Restoration", severity: "Low", title: "D100 service restored",
    description: "Buses have resumed their usual route between KL Sentral and KLCC after an earlier diversion.",
    routes: ["D100"], routeIds: ["D100"], stations: ["KL Sentral"], modes: ["Bus"], age: 18 },
];

export function simulationAlerts(now: number) {
  const window = 60 * MINUTE;
  return scenarios.map(({ age, ...scenario }) => {
    const start = Math.floor((now - MINUTE) / window) * window + MINUTE - age * MINUTE;
    return {
      ...scenario, startedAt: timestamp(start), endsAt: scenario.category === "Restoration" ? timestamp(start) : timestamp(start + window + age * MINUTE),
      dataMode: SIMULATED, source: SIMULATION_SOURCE,
    };
  });
}
export type SimulationAlert = ReturnType<typeof simulationAlerts>[number];

const precincts = [
  ["Esplanade", 5.421, 100.343], ["Little India", 5.417, 100.340], ["Armenian Street", 5.415, 100.337],
  ["Komtar", 5.414, 100.330], ["Macallum", 5.407, 100.332], ["Gurney", 5.436, 100.309],
  ["Pulau Tikus", 5.429, 100.313], ["Weld Quay", 5.413, 100.341], ["Penang Road", 5.421, 100.332],
] as const;
const landmarks = ["North", "Central", "South"];
const random = seededRandom(327);
const docks = precincts.flatMap(([name, lat, lng], district) => landmarks.map((area, index) => ({
  id: `linkbike:sim:${String(district * landmarks.length + index + 1).padStart(2, "0")}`,
  name: `${name} ${area}`, latitude: lat + (1 - index) * .0011 + (random() - .5) * .0004,
  longitude: lng + (random() - .5) * .0013, total: 10 + Math.floor(random() * 19), phase: random() * Math.PI * 2,
})));

export function linkBikeSnapshot(now: number) {
  const slot = Math.floor((now - EPOCH) / MINUTE);
  const fetchedAt = timestamp(now);
  return {
    source: "LinkBike", dataMode: SIMULATED, status: SIMULATED, fetched_at: fetchedAt, refresh_seconds: 60,
    stations: docks.map(dock => {
      const bicycles = Math.round(dock.total * (.5 + .5 * Math.sin(dock.phase + slot / 12)));
      return {
        station_id: dock.id, station_name: dock.name, total_docks: dock.total, available_bikes: bicycles,
        available_docks: dock.total - bicycles, latitude: dock.latitude, longitude: dock.longitude, data_status: SIMULATED, fetched_at: fetchedAt,
      };
    }),
  };
}
export type SimulatedBikeStation = ReturnType<typeof linkBikeSnapshot>["stations"][number];

export function bikeRecords(stations: SimulatedBikeStation[]): TransitRecord[] {
  return stations.map(station => ({
    id: station.station_id, name: station.station_name, station: station.station_name, mode: "Shared bike", operator: "LinkBike",
    route: null, position: [station.latitude, station.longitude], dataMode: SIMULATED, recordKind: "other",
    status: "Station available", source: SIMULATION_SOURCE, reportedAt: station.fetched_at,
    bikesAvailable: station.available_bikes, docksAvailable: station.available_docks,
  }));
}
