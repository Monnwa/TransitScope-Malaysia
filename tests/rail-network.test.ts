import { describe, expect, it } from "vitest";
import { mergeRailStations } from "@/lib/rail-model";
import { mapMode } from "@/lib/official-transit";
import { validRailPath } from "@/lib/rail-network";
import { demoRecords, type Record } from "@/lib/transit-data";
describe("unified railway stations", () => {
  const station = (name: string, mode: Record["mode"], line: string, position: [number, number]): Record => ({ ...demoRecords[2], id: line + name, name, mode, railLines: [line], lineNames: [line], position });
  it("merges co-located cross-mode stations and retains every membership", () => {
    const result = mergeRailStations([station("PASAR SENI", "MRT", "MRT1", [3.14, 101.69]), station("Pasar Seni", "LRT", "LRT-KJ", [3.141, 101.69])]);
    expect(result).toHaveLength(1); expect(result[0].railLines).toEqual(["MRT1", "LRT-KJ"]); expect(result[0].interchange).toBe(true); expect(result[0].modes).toEqual(["MRT", "LRT"]);
  });
  it("does not merge similarly named distant stations", () => {
    expect(mergeRailStations([station("Sentral", "KTM", "KTM:A", [3, 101]), station("Sentral", "KTM", "KTM:B", [5, 101])])).toHaveLength(2);
  });
  it("keeps all KTMB services KTM even when route_type is zero", () => expect(mapMode("0", "KTM")).toBe("KTM"));
  it("rejects invalid axes and large fabricated jumps", () => {
    const path: [number, number][] = Array.from({ length: 15 }, (_, i) => [3 + i * .001, 101.7]);
    expect(validRailPath(path)).toBe(true); expect(validRailPath(path.map(([a, b]) => [b, a]))).toBe(false);
    path[7] = [6, 100]; expect(validRailPath(path)).toBe(false);
  });
});
