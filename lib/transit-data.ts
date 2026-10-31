import { z } from "zod";

export const modeSchema = z.enum(["Bus", "MRT", "LRT", "Monorail", "KTM", "Shared bike"]);
export const dataModeSchema = z.enum(["SIMULATED", "LIVE", "STATIC", "SCHEDULED", "STALE", "UNAVAILABLE", "UNKNOWN"]);
export type Mode = z.infer<typeof modeSchema>;
/** Runtime values are validated by dataModeSchema; the string type keeps UI filter controls extensible. */
export type DataMode = string;
export type Status = "In service" | "Station available" | "Disrupted" | "Unavailable";
export type MrtLineId = "MRT1" | "MRT2";
export type Record = { id: string; name: string; mode: Mode; operator: string; route: string | null; routeId?: string | null; tripId?: string | null; station: string | null; position: [number, number] | null; bearing?: number | null; speed?: number | null; nextScheduledAt?: string | null; routePath?: [number, number][] | null; recordKind?: "vehicle" | "stop" | "other"; mrtLines?: MrtLineId[]; interchange?: boolean; reportedAt: string | null; lastUpdatedAt?: string | null; status: Status; dataMode: DataMode; source: string; bikesAvailable?: number; docksAvailable?: number };
export type FeedHealth = { id: string; label: string; status: "healthy" | "stale" | "unavailable"; lastSuccessAt: string | null; sourceTimestamp: string | null; message: string | null; records: number };
export type TransitApiResponse = { records: Record[]; alerts: Alert[]; feeds: FeedHealth[]; fetchedAt: string; demo: boolean };
export type Alert = { id: string; title: string; description: string; severity: "High" | "Medium" | "Low"; routes: string[]; stations: string[]; startedAt: string; endsAt: string | null; source: string; dataMode: DataMode };

/** Deterministic, fictional records for classroom testing. Coordinates locate central KL but do not report real operations. */
export const demoRecords: Record[] = [
  { id: "DEMO-BUS-101", name: "Demo Bus 101", mode: "Bus", operator: "TransitScope demo", route: "D100", station: null, position: [3.1467, 101.6957], reportedAt: "2026-10-31T10:24:00+08:00", status: "In service", dataMode: "SIMULATED", source: "Deterministic classroom dataset", recordKind: "vehicle" },
  { id: "DEMO-BUS-204", name: "Demo Bus 204", mode: "Bus", operator: "TransitScope demo", route: "D200", station: null, position: [3.1391, 101.6869], reportedAt: "2026-10-31T10:23:00+08:00", status: "In service", dataMode: "SIMULATED", source: "Deterministic classroom dataset", recordKind: "vehicle" },
  { id: "DEMO-MRT-01", name: "Bukit Bintang station", mode: "MRT", operator: "Static reference", route: "Kajang Line", station: "Bukit Bintang", position: [3.1469, 101.7113], reportedAt: null, status: "Station available", dataMode: "SCHEDULED", source: "Static demonstration reference", recordKind: "stop" },
  { id: "DEMO-LRT-01", name: "Masjid Jamek station", mode: "LRT", operator: "Static reference", route: "Kelana Jaya Line", station: "Masjid Jamek", position: [3.1493, 101.6961], reportedAt: null, status: "Station available", dataMode: "SCHEDULED", source: "Static demonstration reference" },
  { id: "DEMO-MONO-01", name: "Raja Chulan station", mode: "Monorail", operator: "Static reference", route: "KL Monorail", station: "Raja Chulan", position: [3.1507, 101.7061], reportedAt: null, status: "Station available", dataMode: "SCHEDULED", source: "Static demonstration reference" },
  { id: "DEMO-KTM-01", name: "Kuala Lumpur station", mode: "KTM", operator: "Static reference", route: "KTM Komuter", station: "Kuala Lumpur", position: [3.1343, 101.6861], reportedAt: null, status: "Station available", dataMode: "SCHEDULED", source: "Static demonstration reference" },
  { id: "DEMO-BIKE-A", name: "Demo Bike Hub A", mode: "Shared bike", operator: "TransitScope demo", route: null, station: "Demo Bike Hub A", position: [3.1432, 101.7021], reportedAt: "2026-10-31T10:25:00+08:00", status: "Station available", dataMode: "SIMULATED", source: "Deterministic classroom dataset", bikesAvailable: 8, docksAvailable: 12 },
  { id: "DEMO-BIKE-B", name: "Demo Bike Hub B", mode: "Shared bike", operator: "TransitScope demo", route: null, station: "Demo Bike Hub B", position: [3.1519, 101.6918], reportedAt: "2026-10-31T10:25:00+08:00", status: "Station available", dataMode: "SIMULATED", source: "Deterministic classroom dataset", bikesAvailable: 3, docksAvailable: 7 }
];

export const demoAlerts: Alert[] = [{ id: "DEMO-ALERT-01", title: "Demonstration: stop access change", description: "Fictional alert for Task C. Allow extra time near the simulated Bukit Bintang station record.", severity: "Medium", routes: ["Kajang Line"], stations: ["Bukit Bintang"], startedAt: "2026-10-31T09:00:00+08:00", endsAt: null, source: "Deterministic classroom dataset", dataMode: "SIMULATED" }];

export const filterRecords = (records: Record[], query: string, modes: Mode[], statuses: Status[], modesData: DataMode[]) => {
  const q = query.trim().toLowerCase();
  // When data mode changes, retain visible records until the UI has reset its mode-selection state.
  // This avoids a transient empty dashboard while preserving explicit record labels.
  const appliesDataMode = modesData.some(mode => records.some(record => record.dataMode === mode));
  return records.filter(r => (!q || [r.id, r.name, r.route, r.station].filter(Boolean).some(v => v!.toLowerCase().includes(q))) && (modes.length === 0 || modes.includes(r.mode)) && (statuses.length === 0 || statuses.includes(r.status)) && (!appliesDataMode || modesData.length === 0 || modesData.includes(r.dataMode)));
};
