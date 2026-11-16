import { expect, test, type Locator, type Page } from "@playwright/test";
import { passengerName } from "../components/passenger-copy";
import { busJourney, busRecords } from "../lib/simulation/vehicles";

const start = Date.parse("2026-11-14T04:00:00Z");
const t401 = "bus:T401:01";
const t401Other = "bus:T401:02";
const t402 = "bus:T402:01";

async function prepareMap(page: Page, time: number) {
  await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, route => route.fulfill({
    contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>',
  }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date(time));
  await page.goto("/");
  const map = page.locator(".leaflet-container");
  await expect(map.locator(".bus-vehicle-icon")).toHaveCount(4);
  await map.scrollIntoViewIfNeeded();
  await map.getByRole("button", { name: "Zoom out" }).click();
  return map;
}

async function activate(locator: Locator, isMobile: boolean) {
  if (isMobile) await locator.tap({ timeout: 5000 });
  else await locator.click({ timeout: 5000 });
}

async function renderedBearing(marker: Locator) {
  return marker.locator(".bus-forward-cue").evaluate((path: SVGPathElement) => {
    const matrix = path.getScreenCTM()!;
    const tip = path.getPointAtLength(0).matrixTransform(matrix);
    const centre = new DOMPoint(16, 16).matrixTransform(matrix);
    return Math.round((Math.atan2(tip.x - centre.x, centre.y - tip.y) * 180 / Math.PI + 360) % 360) % 360;
  });
}

test("shows only the selected bus journey stops and dismisses them with its selection", async ({ page, isMobile }) => {
  test.setTimeout(45_000);
  // Use an interval where different-route buses aren't stacked on the same
  // interchange. Leaflet can only hit the top marker at a shared screen point.
  const times = Array.from({ length: 360 }, (_, tick) => start + tick * 5000);
  const separation = (time: number) => {
    const records = busRecords(time);
    const positions = records.map(bus => bus.position!);
    if (positions.some(([lat, lon]) => Math.abs(lat - 3.142) > .041 || Math.abs(lon - 101.699) > .044)) return -1;
    return Math.min(...positions.flatMap(([lat, lon], i) => positions.slice(i + 1)
      .map(([otherLat, otherLon]) => Math.max(Math.abs(lat - otherLat), Math.abs(lon - otherLon)))));
  };
  const time = times.filter(time => busRecords(time).find(bus => bus.id === t401)!.tripId!.at(-1) !==
      busRecords(time).find(bus => bus.id === t401Other)!.tripId!.at(-1))
    .sort((a, b) => separation(b) - separation(a))[0];
  const map = await prepareMap(page, time);
  const stops = map.locator(".bus-journey-stop");
  const routes = map.locator(".gps-route-completed, .gps-route-remaining, .selected-vehicle-route");
  const detail = page.getByRole("region", { name: "Bus journey detail" });
  const rail = map.locator(".rail-station");
  const stationCount = await rail.count();
  expect(stationCount).toBeGreaterThan(0);
  await expect(stops).toHaveCount(0);
  await expect(routes).toHaveCount(0);
  await expect(map.locator(".bus-vehicle-icon")).toHaveCount(4);
  const outbound = busJourney(t401, time)!;
  const otherDirection = busJourney(t401Other, time)!;
  expect(otherDirection.direction).not.toBe(outbound.direction);

  for (const id of [t401, t401Other, t402]) {
    const journey = busJourney(id, time)!;
    const marker = map.getByTitle(journey.vehicle.name, { exact: true });
    await test.step(`Select ${journey.vehicle.name}`, () => activate(marker, isMobile));
    await expect(detail.getByRole("heading", { name: new RegExp(journey.vehicle.name) })).toBeVisible();
    await expect(map.locator(".vehicle-selected")).toHaveCount(1);
    await expect(marker).toHaveClass(/vehicle-selected/);
    await expect(map.locator(".bus-vehicle-popup")).toHaveCount(1); // Leaflet fades the previous popup out.
    await expect(map.locator(".bus-vehicle-popup")).toContainText(journey.vehicle.name);
    await expect(map.locator(".bus-vehicle-popup")).toContainText("SIMULATED");
    const names = journey.stops.map(stop => passengerName(stop.name)).sort();
    await expect.poll(() => stops.evaluateAll(elements => elements.map(element => element.getAttribute("title")).sort())).toEqual(names);
    await expect(map.locator(".gps-route-completed")).toHaveCount(1);
    await expect(map.locator(".gps-route-remaining")).toHaveCount(1);
    await expect(map.locator(".selected-vehicle-route")).toHaveCount(0);
    await map.getByRole("button", { name: "Close popup" }).click({ timeout: 5000 });
    await expect(stops).toHaveCount(names.length);
    if (isMobile) {
      const collapse = detail.getByRole("button", { name: "Collapse journey" });
      if (await collapse.isVisible()) await collapse.tap();
      if (id === t401) {
        // Pan the southern vehicles clear of the legend on the smaller viewport.
        const relativeTop = () => marker.evaluate(element =>
          element.getBoundingClientRect().top - element.closest(".leaflet-container")!.getBoundingClientRect().top);
        const before = await relativeTop();
        await map.press("ArrowDown");
        // Let Leaflet finish its Date-based animation without crossing a simulation tick.
        await page.clock.setFixedTime(new Date(time + 1000));
        await expect.poll(relativeTop).toBeLessThan(before - 50);
        await expect(stops).toHaveCount(names.length);
      }
    }
  }

  const stop = map.locator(".bus-journey-stop").filter({ visible: true });
  // At low zoom, some adjacent stops overlap. Use a pin whose centre is actually hittable.
  const hittable = await stop.evaluateAll(elements => elements.findIndex(element => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return hit !== null && element.contains(hit);
  }));
  expect(hittable).toBeGreaterThanOrEqual(0);
  await activate(stop.nth(hittable), isMobile);
  await expect(map.locator(".journey-stop-popup")).toContainText("Route T402 · SIMULATED");
  await expect(map.locator(".bus-vehicle-popup")).toHaveCount(0);
  await expect(map.getByTitle("Bus T402-01", { exact: true })).toHaveClass(/vehicle-selected/);
  await expect(map.locator(".vehicle-selected")).toHaveCount(1);

  await detail.getByRole("button", { name: "Close bus journey" }).click();
  await expect(detail).toHaveCount(0);
  await expect(stops).toHaveCount(0);
  await expect(routes).toHaveCount(0);
  await expect(map.locator(".journey-stop-popup")).toHaveCount(0);

  await activate(map.getByTitle("Bus T401-01", { exact: true }), isMobile);
  const background = await map.evaluate(element => {
    const rect = element.getBoundingClientRect();
    for (let y = 45; y < rect.height - 80; y += 18) {
      for (let x = rect.width - 22; x > 60; x -= 18) {
        const target = document.elementFromPoint(rect.left + x, rect.top + y);
        if (target?.classList.contains("leaflet-container")) return {x: rect.left + x, y: rect.top + y};
      }
    }
    return null;
  });
  expect(background).not.toBeNull();
  if (isMobile) await page.touchscreen.tap(background!.x, background!.y);
  else await page.mouse.click(background!.x, background!.y);
  await expect(detail).toHaveCount(0);
  await expect(stops).toHaveCount(0);
  await expect(routes).toHaveCount(0);
  await expect(map.locator(".bus-vehicle-popup")).toHaveCount(0);
  await expect(rail).toHaveCount(stationCount);
  await expect(map.locator(".rail-alignment")).toHaveCount(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("tracks simulated bearing changes and stays stable while the bus is stopped", async ({ page }) => {
  const record = (time: number) => busRecords(time).find(bus => bus.id === t401)!;
  const dwell = Array.from({ length: 360 }, (_, tick) => start + tick * 5000)
    .find(time => record(time).speed === 0 && record(time + 5000).speed === 0)!;
  expect(dwell).toBeDefined();
  const map = await prepareMap(page, dwell);
  const marker = map.getByTitle("Bus T401-01", { exact: true });
  const first = record(dwell);
  const stationary = record(dwell + 5000);
  expect(first.speed).toBe(0);
  expect(stationary.speed).toBe(0);
  expect(stationary.position).toEqual(first.position);
  expect(stationary.bearing).toBe(first.bearing);
  await expect.poll(() => renderedBearing(marker)).toBe(first.bearing! % 360);
  await page.clock.setFixedTime(new Date(dwell + 5000));
  const timeLabel = new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Kuala_Lumpur",
  }).format(dwell + 5000);
  await expect(page.locator("header .fresh span")).toHaveText(`Updated ${timeLabel}`);
  expect(await renderedBearing(marker)).toBe(first.bearing! % 360);

  const moving = Array.from({ length: 60 }, (_, tick) => dwell + (tick + 2) * 5000)
    .find(time => record(time).speed! > 0 && record(time).bearing !== first.bearing)!;
  expect(moving).toBeDefined();
  await page.clock.setFixedTime(new Date(moving));
  await expect.poll(() => renderedBearing(marker)).toBe(record(moving).bearing! % 360);
  await expect(map.locator(".bus-vehicle-icon")).toHaveCount(4);
});
