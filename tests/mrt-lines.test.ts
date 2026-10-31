import { describe, expect, it } from "vitest";
import { mergeMrtStations, mrtLineFromCategory } from "@/lib/official-transit";
import { validateMrtPath } from "@/lib/mrt-lines";
import { demoRecords, type Record } from "@/lib/transit-data";

const station = (name: string, line: "MRT1" | "MRT2"): Record => ({ ...demoRecords[2], id: name + line, name, mrtLines: [line], dataMode: "STATIC" });
describe("MRT route membership", () => {
  it("uses operator route IDs rather than the shared MRT category", () => {
    expect(mrtLineFromCategory("KGL")).toBe("MRT1"); expect(mrtLineFromCategory("PYL")).toBe("MRT2");
    expect(mrtLineFromCategory("MRT")).toBeUndefined(); expect(mrtLineFromCategory("KJ")).toBeUndefined();
  });
  it("merges shared stations, preserving both lines and other transport modes", () => {
    const bus = demoRecords[0];
    const records = mergeMrtStations([station("KWASA DAMANSARA", "MRT1"), station("Kwasa Damansara", "MRT2"), station("TUN RAZAK EXCHANGE", "MRT1"), station("TRX", "MRT2"), station("Kajang", "MRT1"), bus]);
    expect(records).toHaveLength(4);
    expect(records.filter(record => record.interchange)).toHaveLength(2);
    for (const record of records.filter(record => record.interchange)) expect(record.mrtLines).toEqual(["MRT1", "MRT2"]);
    expect(records.find(record => record.name === "Kajang")?.mrtLines).toEqual(["MRT1"]);
    expect(records).toContain(bus);
  });
});
describe("railway geometry safeguards", () => {
  // Synthetic validation fixture only; never used by production rendering.
  const path: [number, number][] = Array.from({ length: 100 }, (_, i) => [2.85 + i * .005, 101.65]);
  const stops = path.filter((_, i) => i % 4 === 0);
  it("accepts a continuous dense WGS84 path covering the station set", () => expect(validateMrtPath(path, stops)).toBe(true));
  it("rejects reversed CRS axes, station-to-station sketches and outlying stations", () => {
    expect(validateMrtPath(path.map(([lat, lon]) => [lon, lat]), stops)).toBe(false);
    expect(validateMrtPath(path.slice(0, 4), stops)).toBe(false);
    expect(validateMrtPath(path, [...stops, [3.1, 101.85]])).toBe(false);
  });
  it("rejects disconnected geometry rather than inventing a bridge", () => {
    const broken = path.map(point => [...point] as [number, number]); broken[50] = [3, 101.8];
    expect(validateMrtPath(broken, stops)).toBe(false);
  });
});
