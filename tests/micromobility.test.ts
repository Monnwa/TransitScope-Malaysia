// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/micromobility/stations/route";
import { adaptLinkBikeStation, micromobilitySnapshot, newMicromobilityStations } from "@/lib/micromobility-data";
import { MICROMOBILITY_OPERATORS, inMicromobilityCoverage, locationLabel, micromobilityStationSchema, stationCounts } from "@/lib/micromobility";
import { linkBikeSnapshot } from "@/lib/simulation/scenarios";

describe("micromobility data integrity", () => {
  it("supports all four operators with stable, unique identities and independently selected coordinates", () => {
    const a = micromobilitySnapshot(), b = micromobilitySnapshot();
    expect(a).toEqual(b);
    expect(a.operators).toEqual(["LINKBIKE", "HELLORIDE", "TRYKE", "BEAM"]);
    expect(new Set(a.stations.map(s => s.id)).size).toBe(a.stations.length);
    expect(new Set(newMicromobilityStations.map(s => `${s.latitude},${s.longitude}`)).size).toBe(48);
    expect(stationCounts(a.stations).map(c => c.total)).toEqual([27,16,16,16]);
  });
  it("validates every station, coverage, simulation provenance, and absent live inventory", () => {
    for (const station of micromobilitySnapshot().stations) {
      expect(micromobilityStationSchema.safeParse(station).success).toBe(true);
      expect(inMicromobilityCoverage(station.latitude, station.longitude)).toBe(true);
      expect(station).toMatchObject({ isSimulation: true, availableBikes: null, availableDocks: null, operationalStatus: "UNVERIFIED" });
      if (station.dataOrigin === "SYNTHETIC") expect(station.verificationStatus).toBe("DEMONSTRATION_ONLY");
      else {
        expect(station.operator).toBe("TRYKE");
        expect(station.sourceUrl).toBe("https://smart.putrajaya.my/en/initiatives/tryke-micromobility/");
        expect(station.sourceDescription).toContain("does not publish exact parking coordinates or live status");
        expect(station.verificationStatus).toBe("APPROXIMATE_LOCATION");
      }
    }
  });
  it.each(MICROMOBILITY_OPERATORS)("retains Klang Valley / Penang coverage for %s where defined", operator => {
    const stations = micromobilitySnapshot().stations.filter(s => s.operator === operator);
    expect(stations.some(s => s.state === "Penang")).toBe(true);
    if (operator !== "LINKBIKE") for (const state of ["Kuala Lumpur", "Selangor", "Putrajaya"]) expect(stations.some(s => s.state === state)).toBe(true);
  });
  it.each([{ latitude: NaN }, { longitude: Infinity }, { latitude: 91 }, { longitude: 181 }, { latitude: 4 },
    { isSimulation: false }, { availableBikes: 3 }, { availableDocks: 0 }, { operationalStatus: "ACTIVE" },
    { verificationStatus: "VERIFIED_LOCATION" }, { dataOrigin: "SOURCE_VERIFIED" }])("rejects unsafe station fields %j", patch => {
    expect(micromobilityStationSchema.safeParse({ ...newMicromobilityStations[0], ...patch }).success).toBe(false);
  });
  it("keeps the LinkBike adapter isolated and never changes original inventory, identity or coordinates", () => {
    const station = linkBikeSnapshot(0).stations[0], original = structuredClone(station);
    expect(adaptLinkBikeStation(station)).toMatchObject({ id: station.station_id, latitude: station.latitude, longitude: station.longitude, availableBikes: null, availableDocks: null });
    expect(station).toEqual(original);
  });
  it("separates approximate source-backed labels from synthetic labels", () => {
    expect(locationLabel(newMicromobilityStations[0])).toContain("SYNTHETIC DEMONSTRATION");
    expect(locationLabel(newMicromobilityStations.find(s => s.dataOrigin === "SOURCE_VERIFIED")!)).toContain("APPROXIMATE POSITION");
  });
});

describe("micromobility API", () => {
  const request = (query = "") => GET(new Request(`http://localhost/api/micromobility/stations${query}`));
  it("retrieves all operators with correct metadata and no external calls", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      const response = await request();
      expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
      const data = await response.json();
      expect(data.stations).toHaveLength(75);
      expect(data.metadata).toMatchObject({ isSimulation: true, realTimeAvailability: false, dataMode: "HYBRID", syntheticLocationsIncluded: true });
      expect(data.status).toBe("SIMULATED"); expect(fetch).not.toHaveBeenCalled();
      for (const station of data.stations) expect(station).toMatchObject({ availableBikes: null, availableDocks: null });
    } finally { fetch.mockRestore(); }
  });
  it.each(MICROMOBILITY_OPERATORS)("filters by %s", async operator => {
    const response = await request(`?operator=${operator}`), data = await response.json();
    expect(response.status).toBe(200); expect(data.stations.length).toBeGreaterThan(0);
    expect(data.stations.every((s: { operator: string }) => s.operator === operator)).toBe(true);
    expect(data.operators).toEqual([operator]);
  });
  it("combines state and case-insensitive area filters", async () => {
    const data = await (await request("?operator=BEAM&state=Penang&area=george%20town")).json();
    expect(data.stations).toHaveLength(2);
    expect(data.stations.every((s: { state: string }) => s.state === "Penang")).toBe(true);
  });
  it("returns an honest successful empty result", async () => {
    const response = await request("?operator=LINKBIKE&state=Putrajaya"), data = await response.json();
    expect(response.status).toBe(200); expect(data.stations).toEqual([]);
    expect(data.metadata.syntheticLocationsIncluded).toBe(false); expect(data.status).toBe("SIMULATED");
  });
  it.each(["?operator=UNKNOWN", "?operator=beam", "?state=Johor", "?area=", "?area=%3Cscript%3E", "?latitude=3", "?operator=TRYKE&operator=BEAM", "?area=" + "a".repeat(81)])("rejects malformed query %s", async query => {
    expect((await request(query)).status).toBe(400);
  });
});
