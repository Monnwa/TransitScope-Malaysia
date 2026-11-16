import { describe, expect, it } from "vitest";
import { filterRecords } from "@/lib/transit-data";
import { simulationSnapshot } from "@/lib/simulation";

const { records } = simulationSnapshot(Date.UTC(2026, 10, 14, 4));

describe("TransitScope filtering", () => {
  it("finds a simulated bus by stable vehicle identifier", () => {
    expect(filterRecords(records, "bus:D100:01", [], [], []).map(record => record.id)).toEqual(["bus:D100:01"]);
  });
  it("finds all 27 LinkBike stations through the mode filter", () => {
    const results = filterRecords(records, "", ["Shared bike"], [], []);
    expect(results).toHaveLength(27);
    expect(results.every(record => record.mode === "Shared bike")).toBe(true);
  });
  it("includes interchanges in each of their transport modes", () => {
    const bts = records.find(record => record.station === "Bandar Tasik Selatan" && record.interchange)!;
    for (const mode of ["LRT", "KTM"] as const) expect(filterRecords(records, bts.name, [mode], [], [])).toContain(bts);
  });
});
