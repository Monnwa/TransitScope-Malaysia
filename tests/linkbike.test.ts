// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/micromobility/linkbike/route";
import { LINKBIKE_PORTAL } from "@/lib/linkbike-data";
import { linkBikeEnabled } from "@/lib/linkbike-feature";
import { createLinkBikeSource } from "@/lib/linkbike";
import { linkBikeStations, parseLinkBikeConsumer, parseLinkBikePortal } from "@/lib/linkbike-parser";

const clock = "12/11/2026 08:19:38pm";
const card = (id = "2", name = "Lebuh &amp; Light", bikes = "7", docks = "12") =>
  `<div class="pnlstationInfo"><p>Station: ${id}</p><p class="stationInfo"><strong>${name}</strong></p>
  <div><p>Dock</p><p>${docks}</p></div><div><p>Bike</p><p>${bikes}</p></div>
  <div><p>Volt</p><p>12.4</p></div></div>`;
const html = (...cards: string[]) => `<p>Last Updated: ${clock}</p>${cards.join("")}`;
const row = (overrides = {}) => ({
  StId: "2", name: "Lebuh & Light", capacity: "12", availbike: "7", volt: "12.4",
  lat: "5.420024", lng: "100.342431", ...overrides,
});
const portal = html(card());
const json = JSON.stringify([row()]);
const stamp = "2026-11-12T12:19:38.915Z";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("LinkBike station normalization", () => {
  it("reads label/value pairs, decodes entities, and preserves string IDs", () => {
    expect(parseLinkBikePortal(html(card("002")))).toEqual({
      updated: clock, rows: [{ id: "002", name: "Lebuh & Light", docks: 12, bikes: 7 }], excluded: 0, warnings: [],
    });
  });

  it.each(["", "<p>Last Updated: today</p>", html(card().replace("<p>7</p>", "")),
    html(card().replace("pnlstationInfo", "other"), card("3"))])("rejects empty or changed structure %#", source => {
    expect(() => parseLinkBikePortal(source)).toThrow();
  });

  it("quarantines duplicate IDs and invalid counts while retaining valid rows", () => {
    const snapshot = parseLinkBikePortal(html(card("3"), card("3"), card("4", "Invalid", "-1"),
      card("5", "Invalid", "1.5"), card("6", "Too many", "13"), card()));
    expect(snapshot.rows.map(station => station.id)).toEqual(["2"]);
    expect(snapshot.warnings).toHaveLength(4);
  });

  it("excludes known and labelled private, mobile and test records", () => {
    const snapshot = parseLinkBikePortal(html(card(), ...["28", "29", "80", "1023"].map(id => card(id)),
      card("88", "Another (Private)"), card("89", "LinkBike Mobile2"), card("90", "Test Dock")));
    expect(snapshot.excluded).toBe(7);
    expect(linkBikeStations(snapshot, stamp)[0].is_public_station).toBeNull();
  });

  it("matches IDs and names, retaining the portal counts and unverified clocks", () => {
    const match = parseLinkBikeConsumer(JSON.stringify([row({ name: " Lebuh & LIGHT ", availbike: "1" })]));
    expect(linkBikeStations(parseLinkBikePortal(portal), stamp, match)[0]).toMatchObject({
      coordinate_status: "VALIDATED_CANDIDATE", latitude: 5.420024, available_bikes: 7,
      available_docks: null, upstream_updated_at: null, fetched_at: stamp, upstream_updated_at_raw: clock,
      data_status: "UNVERIFIED", validation_warnings: [expect.stringContaining("inventory differs")],
    });
  });

  it.each([
    ["2", { name: "Wrong station" }],
    ["2", { lat: "NaN" }],
    ["2", { lat: "100" }],
    ["2", { lng: "80.28" }],
    ["16", {}],
  ])("quarantines an unsafe coordinate join (%s, %j)", (id, overrides) => {
    const match = parseLinkBikeConsumer(JSON.stringify([row({ StId: id, ...overrides })]));
    expect(linkBikeStations(parseLinkBikePortal(html(card(id))), stamp, match)[0]).toMatchObject({
      coordinate_status: "QUARANTINED", latitude: null, longitude: null, source_coordinates: expect.any(Object),
    });
  });

  it("validates the JSON schema and quarantines duplicated IDs", () => {
    expect(() => parseLinkBikeConsumer("{}")).toThrow();
    const parsed = parseLinkBikeConsumer(JSON.stringify([row(), row(), row({ StId: "3" }), row({ StId: "4", volt: 1 })]));
    expect([...parsed.rows.keys()]).toEqual(["3"]);
    expect(parsed.rejected).toBe(3);
  });
});

describe("LinkBike feature gate", () => {
  it("requires a separate, exact opt-in for an identified Vercel Production build", () => {
    const production = { NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" } as const;
    expect(linkBikeEnabled({ ...production, LINKBIKE_ENABLE_NON_PRODUCTION: "true" })).toBe(false);
    expect(linkBikeEnabled({ ...production, NEXT_PUBLIC_ENABLE_LINKBIKE_LAYER: "true" })).toBe(false);
    expect(linkBikeEnabled({ ...production, LINKBIKE_ENABLE_PRODUCTION: "TRUE" })).toBe(false);
    expect(linkBikeEnabled({ ...production, LINKBIKE_ENABLE_PRODUCTION: "true" })).toBe(true);
    expect(linkBikeEnabled({ ...production, VERCEL_TARGET_ENV: undefined, LINKBIKE_ENABLE_PRODUCTION: "true" })).toBe(false);
    expect(linkBikeEnabled({ ...production, VERCEL_ENV: "preview", LINKBIKE_ENABLE_PRODUCTION: "true" })).toBe(false);
    expect(linkBikeEnabled({ NODE_ENV: "production", LINKBIKE_ENABLE_PRODUCTION: "true" })).toBe(false);
  });

  it("keeps local development and Preview explicitly opt-in", () => {
    const local = { NODE_ENV: "development" } as const;
    const preview = { NODE_ENV: "production", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview" } as const;
    for (const env of [local, preview]) {
      expect(linkBikeEnabled(env)).toBe(false);
      expect(linkBikeEnabled({ ...env, NEXT_PUBLIC_ENABLE_LINKBIKE_LAYER: "true" })).toBe(false);
      expect(linkBikeEnabled({ ...env, LINKBIKE_ENABLE_PRODUCTION: "true" })).toBe(false);
      expect(linkBikeEnabled({ ...env, LINKBIKE_ENABLE_NON_PRODUCTION: "true" })).toBe(true);
    }
    expect(linkBikeEnabled({ ...local, VERCEL_ENV: "", LINKBIKE_ENABLE_NON_PRODUCTION: "true" })).toBe(false);
    expect(linkBikeEnabled({ ...local, VERCEL_TARGET_ENV: "development", LINKBIKE_ENABLE_NON_PRODUCTION: "true" })).toBe(false);
  });
});

describe("LinkBike source", () => {
  it("coalesces concurrent callers, preserves fetch time, and drops inventory after a refresh failure", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetch = vi.fn(async (url: string) => new Response(url === LINKBIKE_PORTAL ? portal : json));
    vi.stubGlobal("fetch", fetch);
    const load = createLinkBikeSource();
    const [a, b] = await Promise.all([load(), load()]);
    expect(a).toEqual(b);
    expect(a.status).toBe("UNVERIFIED");
    vi.setSystemTime(Date.now() + 299_000);
    expect((await load()).fetched_at).toBe(a.fetched_at);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 2_000);
    fetch.mockImplementation(async url => url === LINKBIKE_PORTAL ? new Response("", { status: 502 }) : new Response(json));
    const failed = await load();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(failed).toMatchObject({
      status: "UNAVAILABLE", stations: [], upstream_updated_at: null,
      source_health: { portal: { status: "UNAVAILABLE", warning: "Upstream HTTP 502." }, consumer_json: { status: "HEALTHY" } },
    });
    expect((await load()).status).toBe("UNAVAILABLE");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("keeps independent expiry times for each source", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    let completeCoordinates: (response: Response) => void = () => undefined;
    const coordinates = new Promise<Response>(resolve => { completeCoordinates = resolve; });
    const fetch = vi.fn(async (url: string) => url === LINKBIKE_PORTAL ? new Response(portal) : coordinates);
    vi.stubGlobal("fetch", fetch);
    const load = createLinkBikeSource();
    const first = load();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await new Promise(resolve => setImmediate(resolve));
    vi.setSystemTime(start + 3000);
    completeCoordinates(new Response(json));
    await first;
    vi.setSystemTime(start + 301_000);
    await load();
    expect(fetch.mock.calls.map(([url]) => url).filter(url => url === LINKBIKE_PORTAL)).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("enforces timeout and rejects oversize or malformed responses", async () => {
    const holdEventLoop = setTimeout(() => undefined, 100);
    vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => url === LINKBIKE_PORTAL ?
      new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))) :
      Promise.resolve(new Response("bad JSON"))));
    try {
      const result = await createLinkBikeSource(300, 10)();
      expect(result.source_health.portal.warning).toMatch(/timed out/);
      expect(result.source_health.consumer_json.status).toBe("UNAVAILABLE");
    } finally { clearTimeout(holdEventLoop); }
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url === LINKBIKE_PORTAL ? "x".repeat(512_001) : json)));
    expect(await createLinkBikeSource()()).toMatchObject({ status: "UNAVAILABLE", stations: [] });
  });

  it("returns bounded simulated inventory regardless of retired rollout flags", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const enabled of ["false", "true"]) {
      vi.stubEnv("LINKBIKE_ENABLE_PRODUCTION", enabled);
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("VERCEL_TARGET_ENV", "production");
      vi.stubEnv("NODE_ENV", "production");
      const response = await GET();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const data = await response.json();
      expect(data.status).toBe("SIMULATED");
      expect(data.dataMode).toBe("SIMULATED");
      expect(data.stations).toHaveLength(27);
      for (const station of data.stations) {
        expect(station.data_status).toBe("SIMULATED");
        expect(station.available_bikes).toBeGreaterThanOrEqual(0);
        expect(station.available_bikes + station.available_docks).toBe(station.total_docks);
      }
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps reported portal counts and suppresses coordinates when the consumer source fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === LINKBIKE_PORTAL ?
      new Response(portal) : new Response(null, { status: 503 })));
    expect(await createLinkBikeSource()()).toMatchObject({
      status: "UNVERIFIED",
      source_health: { portal: { status: "HEALTHY" }, consumer_json: { status: "UNAVAILABLE" } },
      stations: [{ available_bikes: 7, latitude: null, longitude: null, source_coordinates: null,
        coordinate_status: "UNAVAILABLE", upstream_updated_at: null }],
    });
  });
});
