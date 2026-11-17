import { expect, test, type Locator, type Page } from "@playwright/test";
import { passengerName } from "../components/passenger-copy";
import { busJourney, busRecords } from "../lib/simulation/vehicles";

const start = Date.parse("2026-11-14T04:00:00Z");
const t401 = "bus:T401:01";
const t401Other = "bus:T401:02";
const t402 = "bus:T402:01";

async function prepareMap(page: Page, time: number, mobile: boolean) {
  await page.setViewportSize(mobile ? { width: 375, height: 844 } : { width: 1265, height: 720 });
  await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, route => route.fulfill({
    contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>',
  }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date(time));
  await page.goto("/");
  const map = page.locator(".leaflet-container");
  await expect(map.locator(".bus-vehicle-icon")).toHaveCount(4);
  await map.scrollIntoViewIfNeeded();
  await expect(map).toHaveAttribute("data-bus-view", "OVERVIEW");
  return map;
}

async function activate(locator: Locator, isMobile: boolean) {
  if (isMobile) await locator.tap({ timeout: 5000 });
  else await locator.click({ timeout: 5000 });
}

async function markerFrames(map: Locator) {
  return map.locator(".bus-vehicle-icon").evaluateAll(elements => elements.map(element => {
    const cue = element.querySelector<SVGPathElement>(".bus-forward-cue")!;
    const matrix = cue.getScreenCTM()!;
    const tip = cue.getPointAtLength(0).matrixTransform(matrix);
    const centre = new DOMPoint(16, 16).matrixTransform(matrix);
    const transform = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return {
      title: element.getAttribute("title"),
      angle: Math.round((Math.atan2(tip.x - centre.x, centre.y - tip.y) * 180 / Math.PI + 360) % 360) % 360,
      position: [transform.m41, transform.m42],
    };
  }));
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
  const map = await prepareMap(page, time, isMobile);
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

  let interactionTime = time;
  const finishPan = () => page.clock.setFixedTime(new Date(interactionTime += 1000));
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
    // Leaflet popup auto-pan uses Date.now; allow it to finish under the fixed clock.
    await finishPan();
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
        await finishPan();
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

test("moves the selected bus without rotating its icon", async ({ page, isMobile }) => {
  await page.setViewportSize(isMobile ? { width: 375, height: 844 } : { width: 1265, height: 720 });
  const record = (at: number) => busRecords(at).find(bus => bus.id === t401)!;
  const first = record(start);
  const moving = Array.from({ length: 48 }, (_, tick) => start + (tick + 1) * 5000)
    .find(at => {
      const next = record(at);
      return next.speed! > 0 && next.bearing !== first.bearing
        && Math.hypot(next.position![0] - first.position![0], next.position![1] - first.position![1]) > .001;
    })!;
  expect(moving).toBeDefined();
  const next = record(moving);
  expect(next.id).toBe(first.id);
  expect(next.position).not.toEqual(first.position);
  expect(next.bearing).not.toBe(first.bearing);

  const map = await prepareMap(page, start, isMobile);
  await expect(map).not.toHaveClass(/leaflet-zoom-anim/);
  const assertUpright = () => expect.poll(async () => (await markerFrames(map)).map(frame => frame.angle)).toEqual([0, 0, 0, 0]);
  await assertUpright();
  const marker = map.getByTitle(first.name, { exact: true });
  if (!isMobile) {
    await marker.hover();
    await expect(map.getByRole("tooltip")).toHaveText(`${first.name} · SIMULATED`);
  }
  await activate(marker, isMobile);
  await page.clock.setFixedTime(new Date(start + 1000));
  await expect(map.locator(".bus-vehicle-popup")).toContainText(first.name);
  await map.getByRole("button", { name: "Close popup" }).click();
  await expect(map.locator(".bus-vehicle-popup")).toHaveCount(0);

  const detail = page.getByRole("region", { name: "Bus journey detail" });
  await detail.getByText("Technical information", { exact: true }).click();
  const coordinates = detail.locator("dd").filter({ hasText: /^\d+\.\d{5}, \d+\.\d{5}$/ });
  await expect(detail.getByText(t401, { exact: true })).toBeAttached();
  await expect(coordinates).toHaveText(first.position!.map(value => value.toFixed(5)).join(", "));
  const oldGlyph = await marker.locator(".bus-vehicle-glyph").elementHandle();
  const before = await markerFrames(map);
  const busPosition = async () => (await markerFrames(map)).find(frame => frame.title === first.name)!.position;

  await page.clock.setFixedTime(new Date(moving));
  await expect(coordinates).toHaveText(next.position!.map(value => value.toFixed(5)).join(", "));
  await expect(detail.getByText(`${next.bearing}°`, { exact: true })).toBeAttached();
  await expect.poll(busPosition).not.toEqual(before.find(frame => frame.title === first.name)!.position);
  await expect(marker).toHaveClass(/vehicle-selected/);
  await expect(detail.getByText(t401, { exact: true })).toBeAttached();
  expect(await marker.locator(".bus-vehicle-glyph").evaluate((node, previous) => node === previous, oldGlyph)).toBe(true);
  await assertUpright();
  console.log(JSON.stringify({ vehicle: t401, desktop: !isMobile,
    first: { bearing: first.bearing, coordinates: first.position, frames: before },
    next: { bearing: next.bearing, coordinates: next.position, frames: await markerFrames(map) } }));

  if (isMobile) await detail.getByRole("button", { name: "Collapse journey" }).tap();
  const previousZoom = Number(await map.getAttribute("data-bus-zoom"));
  await map.getByRole("button", { name: "Zoom in" }).click();
  await expect(map).toHaveAttribute("data-bus-zoom", String(previousZoom + 1));
  await expect(map).not.toHaveClass(/leaflet-zoom-anim/);
  const relativeTop = () => marker.evaluate(element =>
    element.getBoundingClientRect().top - element.closest(".leaflet-container")!.getBoundingClientRect().top);
  const beforePan = await relativeTop();
  await map.press("ArrowDown");
  await page.clock.setFixedTime(new Date(moving + 1000));
  await expect.poll(relativeTop).toBeLessThan(beforePan - 50);
  await assertUpright();
  await expect(marker).toHaveClass(/vehicle-selected/);
});
