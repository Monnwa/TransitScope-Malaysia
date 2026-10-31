import { describe, expect, it } from "vitest";
import { demoRecords, filterRecords } from "@/lib/transit-data";
describe("TransitScope filtering", () => {
  it("finds a record by fictional vehicle identifier", () => expect(filterRecords(demoRecords, "DEMO-BUS-101", [], [], []).map(r => r.id)).toEqual(["DEMO-BUS-101"]));
  it("only returns shared-bike records when the mode filter is applied", () => expect(filterRecords(demoRecords, "", ["Shared bike"], [], []).every(r => r.mode === "Shared bike")).toBe(true));
  it("keeps unavailable reporting timestamps explicit for station records", () => expect(demoRecords.find(r => r.id === "DEMO-MRT-01")?.reportedAt).toBeNull());
});
