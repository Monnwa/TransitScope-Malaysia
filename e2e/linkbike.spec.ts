import { expect, test } from "@playwright/test";
import type { LinkBikeResponse, LinkBikeStation } from "../lib/linkbike-data";
import { linkBikeEnabled } from "../lib/linkbike-feature";
import { rapidRailMeta } from "../lib/rail-model";
import { trainPath, trainPayload, trainTime } from "../tests/fixtures/train-positions";

const enabled = linkBikeEnabled({ ...process.env, NODE_ENV: "development" });
const fetchedAt = "2026-11-12T12:19:38.915Z";
const candidate: LinkBikeStation = {
  source: "LinkBike", station_id: "2", station_name: "Lebuh Light", total_docks: 12,
  available_bikes: 7, available_docks: null, latitude: 5.420024, longitude: 100.342431,
  source_coordinates: { latitude: "5.420024", longitude: "100.342431" }, upstream_updated_at: null,
  upstream_updated_at_raw: "12/11/2026 08:19:38pm", fetched_at: fetchedAt, data_status: "UNVERIFIED",
  is_public_station: null, coordinate_status: "VALIDATED_CANDIDATE", validation_warnings: [],
};
const payload: LinkBikeResponse = {
  source: "LinkBike", status: "UNVERIFIED", fetched_at: fetchedAt, upstream_updated_at: null,
  upstream_updated_at_raw: candidate.upstream_updated_at_raw,
  stations: [candidate, {
    ...candidate, station_id: "16", station_name: "Quarantined candidate",
    latitude: null, longitude: null, coordinate_status: "QUARANTINED",
  }],
  source_health: {
    portal: { status: "HEALTHY", fetched_at: fetchedAt, warning: null },
    consumer_json: { status: "HEALTHY", fetched_at: fetchedAt, warning: null },
  },
  refresh_seconds: 300, excluded_stations: 4, warnings: [],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/transit?*", route =>
    route.fulfill({ json: { records: [], feeds: [], alerts: [], fetchedAt, demo: false } }));
  await page.route("**/api/rail-network?*", route =>
    route.fulfill({ json: { available: true, lines: [], stations: [], source: "Test" } }));
  await page.route("**/api/train-positions", route => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/alerts", route => route.fulfill({ status: 503, json: {} }));
});

test("flag off hides the layer and disables the API", async ({ page, request }) => {
  test.skip(enabled, "Run with the feature flag disabled.");
  let requests = 0;
  page.on("request", req => { if (req.url().endsWith("/api/micromobility/linkbike")) requests++; });
  await page.goto("/");
  await expect(page.getByLabel("Interactive transport map")).toBeVisible();
  await expect(page.getByLabel("Show LinkBike stations")).toHaveCount(0);
  expect(requests).toBe(0);
  expect((await request.get("/api/micromobility/linkbike")).status()).toBe(404);
});

test("demo mode excludes LinkBike when the feature is enabled", async ({ page }) => {
  test.skip(!enabled, "Run with the feature flag enabled.");
  let requests = 0;
  await page.route("**/api/micromobility/linkbike", route => {
    requests++;
    return route.fulfill({ json: payload });
  });
  await page.goto("/?mode=demo");
  await expect(page.getByRole("button", { name: "Shared bike", exact: true })).toBeVisible();
  await expect(page.getByLabel("Show LinkBike stations")).toHaveCount(0);
  expect(requests).toBe(0);
});

for (const width of [390, 768, 1440]) {
  test(`LinkBike toggle, validated markers and station details at ${width}px`, async ({ page }) => {
    test.skip(!enabled, "Run with the feature flag enabled.");
    await page.setViewportSize({ width, height: 850 });
    let requests = 0;
    await page.route("**/api/micromobility/linkbike", route => {
      requests++;
      return route.fulfill({ json: payload });
    });
    await page.goto("/");
    const toggle = page.getByLabel("Show LinkBike stations");
    await expect(toggle).not.toBeChecked();
    expect(requests).toBe(0);
    const mapPane = page.locator(".leaflet-map-pane");
    const before = await mapPane.getAttribute("style");
    await toggle.check();
    await expect(page.locator(".linkbike-marker")).toHaveCount(1);
    await expect(mapPane).toHaveAttribute("style", before!);
    await page.getByRole("button", { name: "Zoom to LinkBike stations" }).click();
    await page.getByTitle("LinkBike candidate: Lebuh Light").click();
    const details = page.getByLabel("LinkBike station details");
    await expect(details).toBeVisible();
    await expect(details.locator("dd")).toHaveText([
      "2", "7", "12", "Not provided", "UNVERIFIED", /MYT$/, candidate.upstream_updated_at_raw,
      "Passed location checks. Public access is unverified.",
    ]);
    await expect(details.getByRole("link", { name: "LinkBike Maintenance Portal" })).toBeVisible();
    await expect(details).toContainText("Retrieved by TransitScope");
    await expect(details).toContainText("Portal timestamp (unverified)");
    await expect(details).not.toContainText(/available bikes|live|real.time/i);
    const box = await details.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
    await toggle.uncheck();
    await expect(details).toHaveCount(0);
    await expect(page.locator(".linkbike-marker")).toHaveCount(0);
    expect(requests).toBe(1);
  });
}

test("an unavailable refresh clears old LinkBike markers", async ({ page }) => {
  test.skip(!enabled, "Run with the feature flag enabled.");
  let requests = 0;
  await page.clock.install();
  await page.route("**/api/micromobility/linkbike", route => ++requests !== 2 ?
    route.fulfill({ json: payload }) :
    route.fulfill({ status: 503, json: { ...payload, status: "UNAVAILABLE", stations: [] } }));
  await page.goto("/");
  await page.getByLabel("Show LinkBike stations").check();
  await expect(page.locator(".linkbike-marker")).toHaveCount(1);
  await page.clock.fastForward(301_000);
  await expect(page.getByText("LinkBike information unavailable.")).toBeVisible();
  await expect(page.locator(".linkbike-marker")).toHaveCount(0);
  await page.getByLabel("Show LinkBike stations").uncheck();
  await page.getByLabel("Show LinkBike stations").check();
  await expect(page.locator(".linkbike-marker")).toHaveCount(1);
  expect(requests).toBe(3);
});

test("LinkBike polling pauses while hidden and resumes once without overlapping a slow request", async ({ page }) => {
  test.skip(!enabled, "Run with the feature flag enabled.");
  await page.clock.install();
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", { get: () => document.documentElement?.dataset.testVisibility ?? "hidden" });
  });
  const visibility = (state: string) => page.evaluate(value => {
    document.documentElement.dataset.testVisibility = value;
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
  let requests = 0;
  let completeSlow: () => void = () => undefined;
  const slow = new Promise<void>(resolve => { completeSlow = resolve; });
  await page.route("**/api/micromobility/linkbike", async route => {
    const request = ++requests;
    if (request === 1) await slow;
    await route.fulfill({ json: { ...payload, refresh_seconds: 60, stations: [
      { ...candidate, station_id: String(request), station_name: `Poll ${request}` },
    ] } });
  });
  await page.goto("/");
  await expect(page.getByLabel("Interactive transport map")).toBeVisible();
  await page.getByLabel("Show LinkBike stations").check();
  await page.clock.fastForward(301_000);
  expect(requests).toBe(0);

  await visibility("visible");
  await visibility("visible");
  await expect.poll(() => requests).toBe(1);
  await visibility("hidden");
  await page.clock.fastForward(301_000);
  await visibility("visible");
  await page.clock.fastForward(301_000);
  expect(requests).toBe(1);

  await visibility("hidden");
  completeSlow();
  await expect(page.locator(".linkbike-marker")).toHaveCount(1);
  await page.clock.fastForward(301_000);
  expect(requests).toBe(1);
  await visibility("visible");
  await visibility("visible");
  await expect(page.getByTitle("LinkBike candidate: Poll 2")).toHaveCount(1);

  // Hide with a scheduled timer, then allow the next visible period to refresh once.
  await visibility("hidden");
  await page.clock.fastForward(301_000);
  expect(requests).toBe(2);
  await visibility("visible");
  await expect(page.getByTitle("LinkBike candidate: Poll 3")).toHaveCount(1);
  await page.clock.fastForward(61_000);
  await expect.poll(() => requests).toBe(4);
});

test("LinkBike polling aborts on disable and unmount and ignores an old response after re-enable", async ({ page }) => {
  test.skip(!enabled, "Run with the feature flag enabled.");
  await page.clock.install();
  await page.addInitScript(() => {
    const original = window.fetch;
    let requests = 0;
    window.fetch = (input, init) => {
      if (input !== "/api/micromobility/linkbike") return original(input, init);
      const request = String(++requests);
      document.documentElement.dataset.linkBikeAborted ??= "";
      const recordAbort = () => { document.documentElement.dataset.linkBikeAborted += request; };
      init?.signal?.addEventListener("abort", recordAbort, { once: true });
      // Simulate a transport that delivers a response even after an abort.
      return original(input, { ...init, signal: undefined }).then(response => {
        init?.signal?.removeEventListener("abort", recordAbort);
        document.documentElement.dataset.linkBikeDelivered += request;
        return response;
      });
    };
  });
  let requests = 0;
  let releaseOld: () => void = () => undefined;
  let releaseNavigation: () => void = () => undefined;
  const old = new Promise<void>(resolve => { releaseOld = resolve; });
  const navigation = new Promise<void>(resolve => { releaseNavigation = resolve; });
  await page.route("**/api/micromobility/linkbike", async route => {
    const request = ++requests;
    if (request === 1) await old;
    if (request === 3) await navigation;
    await route.fulfill({ json: { ...payload, stations: [{ ...candidate, station_name: `Response ${request}` }] } });
  });
  await page.goto("/");
  await expect(page.getByLabel("Interactive transport map")).toBeVisible();
  await page.locator("html").evaluate(element => { element.dataset.linkBikeDelivered = ""; });
  const toggle = page.getByLabel("Show LinkBike stations");
  await toggle.check();
  await expect.poll(() => requests).toBe(1);
  await toggle.uncheck();
  await expect(page.locator("html")).toHaveAttribute("data-link-bike-aborted", "1");
  await page.clock.fastForward(301_000);
  expect(requests).toBe(1);

  await toggle.check();
  await expect(page.getByTitle("LinkBike candidate: Response 2")).toHaveCount(1);
  releaseOld();
  await expect(page.locator("html")).toHaveAttribute("data-link-bike-delivered", "21");
  await page.clock.runFor(20);
  await expect(page.getByTitle("LinkBike candidate: Response 2")).toHaveCount(1);
  await expect(page.getByTitle("LinkBike candidate: Response 1")).toHaveCount(0);

  await page.clock.fastForward(301_000);
  await expect.poll(() => requests).toBe(3);
  // Switching to demo unmounts LinkBike without destroying the browser document.
  await page.getByRole("button", { name: "Use demo data" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-link-bike-aborted", "13");
  releaseNavigation();
  await expect(page.locator("html")).toHaveAttribute("data-link-bike-delivered", "213");
  await page.clock.fastForward(601_000);
  expect(requests).toBe(3);
  await expect(toggle).toHaveCount(0);

  await page.goto("/?mode=demo");
  await expect(page.getByLabel("Interactive transport map")).toBeVisible();
  await page.clock.fastForward(301_000);
  expect(requests).toBe(3);
});

test("LinkBike polling clears failed inventory and waits the default interval on invalid retry hints", async ({ page }) => {
  test.skip(!enabled, "Run with the feature flag enabled.");
  await page.clock.install();
  let requests = 0;
  await page.route("**/api/micromobility/linkbike", route => ++requests === 1 ?
    route.fulfill({ json: { ...payload, refresh_seconds: 60 } }) :
    route.fulfill({ status: 503, json: { ...payload, status: "UNAVAILABLE", stations: [], refresh_seconds: requests === 2 ? 3601 : 1 } }));
  await page.goto("/");
  await expect(page.getByLabel("Interactive transport map")).toBeVisible();
  await page.getByLabel("Show LinkBike stations").check();
  await expect(page.locator(".linkbike-marker")).toHaveCount(1);
  await page.clock.fastForward(61_000);
  await expect(page.getByText("LinkBike information unavailable.")).toBeVisible();
  await expect(page.locator(".linkbike-marker")).toHaveCount(0);
  await page.clock.fastForward(200_000);
  expect(requests).toBe(2);
  await page.clock.fastForward(101_000);
  await expect.poll(() => requests).toBe(3);
  await page.clock.fastForward(200_000);
  expect(requests).toBe(3);
});

for (const width of [390, 1440]) {
  test(`LinkBike preserves bus, train and station state at ${width}px`, async ({ page }) => {
    test.skip(!enabled, "Run with the feature flag enabled.");
    await page.setViewportSize({ width, height: 850 });
    await page.clock.install({ time: new Date(trainTime()) });
    const line = { ...rapidRailMeta.KGL, paths: [trainPath], geometryStatus: "available", dataMode: "STATIC" };
    const bus = { id: "B", name: "Isolation Bus", mode: "Bus", recordKind: "vehicle", dataMode: "LIVE",
      status: "In service", position: [3.138, 101.705], route: "T1", reportedAt: new Date(trainTime()).toISOString() };
    const stop = { id: "S", name: "Isolation Station", mode: "MRT", recordKind: "stop", dataMode: "STATIC",
      status: "Station available", position: [3.146, 101.700], railLines: [line.id], lineNames: [line.name] };
    await page.route("**/api/transit?*", route =>
      route.fulfill({ json: { records: route.request().url().includes("includeStatic") ? [] : [bus],
        feeds: [], alerts: [], fetchedAt, demo: false } }));
    await page.route("**/api/rail-network?*", route =>
      route.fulfill({ json: { lines: route.request().url().includes("ktmb") ? [] : [line],
        stations: route.request().url().includes("ktmb") ? [] : [stop], available: true, source: "Isolation fixture" } }));
    await page.route("**/api/train-positions", route => route.fulfill({ json: trainPayload({ route: "KGL" }) }));
    await page.route("**/api/departures?*", route => route.fulfill({ status: 503, json: {} }));
    await page.route("**/api/micromobility/linkbike", route =>
      route.fulfill({ json: { ...payload, stations: [{ ...candidate, latitude: 3.153, longitude: 101.705 }] } }));
    await page.goto("/");
    const bikeToggle = page.getByLabel("Show LinkBike stations");
    const trainToggle = page.getByRole("checkbox", { name: "Estimated train positions", exact: true });
    const lineToggle = page.getByLabel(`Show ${line.name}`, { exact: true });
    const bikes = page.locator(".linkbike-marker"), trains = page.locator(".estimated-train-icon");
    const buses = page.locator(".vehicle-icon"), stations = page.locator(".rail-station");
    const busFilter = page.getByRole("button", { name: "Bus", exact: true });
    await trainToggle.check();
    await expect(trains).toHaveCount(1);
    await expect(buses).toHaveCount(1);
    await expect(stations).toHaveCount(1);
    await bikeToggle.check();
    await expect(bikes).toHaveCount(1);
    await expect(trains).toHaveCount(1);
    await expect(buses).toHaveCount(1);
    await expect(lineToggle).toBeChecked();
    await expect(busFilter).toHaveAttribute("aria-pressed", "false");

    await busFilter.click();
    await expect(trains).toHaveCount(0);
    await expect(bikes).toHaveCount(1);
    await bikeToggle.uncheck();
    await expect(busFilter).toHaveAttribute("aria-pressed", "true");
    await bikeToggle.check();
    await expect(bikes).toHaveCount(1);
    await expect(busFilter).toHaveAttribute("aria-pressed", "true");
    await busFilter.click();
    const railFilter = page.getByRole("button", { name: "MRT", exact: true });
    await railFilter.click();
    await expect(buses).toHaveCount(0);
    await expect(bikes).toHaveCount(1);
    await railFilter.click();
    await lineToggle.uncheck();
    await expect(stations).toHaveCount(0);
    await expect(bikes).toHaveCount(1);
    await lineToggle.check();
    await trainToggle.uncheck();
    await expect(bikes).toHaveCount(1);
    await trainToggle.check();
    await expect(trains).toHaveCount(1);

    await stations.click();
    const transitDetails = page.getByLabel("Selected transport detail");
    await expect(transitDetails).toContainText("Isolation Station");
    // Close the map bubble that overlaps the bike marker. The transit detail panel stays selected.
    await page.locator(".leaflet-popup-close-button").click();
    await bikes.click();
    await expect(page.getByLabel("LinkBike station details")).toBeVisible();
    await page.locator(".leaflet-popup-close-button").click();
    await expect(page.getByLabel("LinkBike station details")).toHaveCount(0);
    await expect(transitDetails).toContainText("Isolation Station");
    await expect(bikes).toHaveCount(1);
  });
}
