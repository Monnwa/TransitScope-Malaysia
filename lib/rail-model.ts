import type { Mode, Record as TransitRecord } from "@/lib/transit-data";
export type RailLine = { id: string; name: string; colour: string; mode: Mode; paths: [number, number][][]; source: string; dataMode: "STATIC" | "SIMULATED"; geometryStatus: "available" | "unavailable" };
export type RailNetwork = { lines: RailLine[]; stations: TransitRecord[]; source: string; available: boolean };
export const rapidRailMeta: Record<string, { id: string; name: string; colour: string; mode: "MRT" | "LRT" | "Monorail" }> = {
  KGL: { id: "MRT1", name: "MRT Kajang Line (MRT1)", colour: "#006B3F", mode: "MRT" },
  PYL: { id: "MRT2", name: "MRT Putrajaya Line (MRT2)", colour: "#F2C500", mode: "MRT" },
  KJ: { id: "LRT-KJ", name: "LRT Kelana Jaya Line", colour: "#E75480", mode: "LRT" },
  AG: { id: "LRT-AG", name: "LRT Ampang Line", colour: "#E87524", mode: "LRT" },
  PH: { id: "LRT-PH", name: "LRT Sri Petaling Line", colour: "#7651A8", mode: "LRT" },
  MR: { id: "MONORAIL", name: "KL Monorail", colour: "#2878B5", mode: "Monorail" },
};
const normalized = (name: string) => name.toUpperCase().replace(/\b(STESEN|STATION|MRT|LRT|KTM)\b/g, "").replace(/[^A-Z0-9]/g, "");
export function mergeRailStations(records: TransitRecord[]): TransitRecord[] {
  const groups: TransitRecord[] = [];
  for (const station of records) {
    // Merge matching station names only within walking-distance station complexes.
    const existing = groups.find(group => normalized(group.name) === normalized(station.name) && group.position && station.position && Math.hypot(group.position[0] - station.position[0], group.position[1] - station.position[1]) < .008);
    if (!existing) { groups.push({ ...station, id: `rail:${station.id}`, railLines: [...(station.railLines ?? [])], lineNames: [...(station.lineNames ?? [])], modes: station.modes ?? [station.mode] }); continue; }
    existing.stopRefs = [...new Set([...(existing.stopRefs ?? []), ...(station.stopRefs ?? [])])];
    existing.railLines = [...new Set([...existing.railLines!, ...(station.railLines ?? [])])];
    existing.lineNames = [...new Set([...existing.lineNames!, ...(station.lineNames ?? [])])];
    existing.modes = [...new Set([...existing.modes!, station.mode])];
    existing.mrtLines = [...new Set([...(existing.mrtLines ?? []), ...(station.mrtLines ?? [])])];
    existing.route = existing.lineNames.join(" · "); existing.interchange = existing.railLines.length > 1;
    existing.source = [...new Set([existing.source, station.source])].join("; ");
  }
  return groups.map(station => ({ ...station, interchange: (station.railLines?.length ?? 0) > 1 }));
}
