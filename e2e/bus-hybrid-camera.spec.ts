import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { busRecords } from "../lib/simulation/vehicles";

const start = Date.parse("2026-11-14T04:00:00Z");
const busId = "bus:T401:01";
const busAt = (time: number) => busRecords(time).find(bus => bus.id === busId)!;
const movingTimes = Array.from({ length: 180 }, (_, index) => start + (index + 1) * 5000)
  .filter(time => Math.hypot(busAt(time).position![0] - busAt(start).position![0], busAt(time).position![1] - busAt(start).position![1]) > .012);

async function prepare(page: Page, mobile: boolean, dimensions?: { width: number; height: number }) {
  await page.setViewportSize(dimensions ?? (mobile ? { width: 375, height: 844 } : { width: 1265, height: 720 }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date(start));
  await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, route => route.fulfill({
    contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#eff2f0" d="M0 0h256v256H0z"/></svg>',
  }));
  await page.goto("/");
  const map = page.locator(".leaflet-container");
  await expect(map).toHaveAttribute("data-camera-state", "OVERVIEW");
  await page.locator(".map-camera-frame").scrollIntoViewIfNeeded();
  // Wait for the ResizeObserver/scroll coalescing frames, rather than a timed sleep.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return map;
}
const camera = async (map: Locator) => ({ latitude: await map.getAttribute("data-camera-latitude"),
  longitude: await map.getAttribute("data-camera-longitude"), zoom: await map.getAttribute("data-camera-zoom") });
async function selectBus(page: Page) {
  await page.getByRole("row", { name: /^Bus T401-01 / }).getByRole("button", { name: "View details" }).click();
  await expect(page.getByRole("region", { name: "Bus journey detail" })).toBeVisible();
}
async function advance(page: Page, time: number) {
  await page.clock.setFixedTime(new Date(time));
  const coordinates = busAt(time).position!.map(value => value.toFixed(5)).join(", ");
  await expect(page.locator(".bus-technical .details dd").filter({ hasText: coordinates })).toHaveCount(1);
}
async function barePoint(map: Locator) {
  return map.evaluate(element => {
    const box = element.getBoundingClientRect();
    for (let y = 70; y < Math.min(box.height - 90, innerHeight - box.top - 70); y += 20) {
      for (let x = 70; x < box.width - 40; x += 20) {
        const hit = document.elementFromPoint(box.left + x, box.top + y);
        if (hit?.closest(".leaflet-container") === element && !hit.closest(".leaflet-interactive,.leaflet-control,.leaflet-popup,.map-legend")) return { x: box.left + x, y: box.top + y };
      }
    }
    throw Error("No unobstructed map gesture target");
  });
}
async function drag(page: Page, map: Locator, mobile: boolean) {
  const point = await barePoint(map);
  if (mobile) {
    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 1 }] });
    for (let step = 1; step <= 5; step++) {
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x + step * 12, y: point.y + step * 6, id: 1 }] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await client.detach();
  } else {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 60, point.y + 30, { steps: 6 });
    await page.mouse.up();
  }
  await expect(map).toHaveAttribute("data-camera-state", "FREE_EXPLORE");
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(name + "-synthetic-tiles.png"), scale: "css" });
}
async function vehicleUnobstructed(map: Locator) {
  await expect.poll(() => map.getByTitle("Bus T401-01", { exact: true }).evaluate(element => {
    const box = element.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    return element.contains(document.elementFromPoint(x, y)) && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight;
  })).toBe(true);
}

test("explicit focus follows, manual drag suspends, Return resumes and route intent stays explicit", async ({ page, isMobile }, info) => {
  test.setTimeout(90000);
  const map = await prepare(page, isMobile);
  const mapNode = await map.elementHandle();
  await screenshot(page, info, "overview");
  await selectBus(page);
  await expect(map).toHaveAttribute("data-camera-state", "OVERVIEW");
  const glyph = await map.getByTitle("Bus T401-01", { exact: true }).locator("svg").elementHandle();
  const controls = page.getByRole("group", { name: "Map camera" });
  await controls.getByRole("button", { name: "Locate bus", exact: true }).click();
  await expect(map).toHaveAttribute("data-camera-state", "VEHICLE_FOCUS");
  await expect(map).not.toHaveClass(/leaflet-zoom-anim/);
  await vehicleUnobstructed(map);
  for (const locator of [controls.getByRole("button", { name: "Overview", exact: true }), map.locator(".leaflet-control-attribution"), map.getByRole("button", { name: "Zoom in", exact: true })]) {
    await expect.poll(() => locator.evaluate(element => {
      const box = element.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
      return x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && element.contains(document.elementFromPoint(x, y));
    })).toBe(true);
  }
  if (!isMobile) await expect(page.getByRole("region", { name: "Bus journey detail" }).getByRole("heading", { name: /Bus T401-01/ })).toBeInViewport();
  await screenshot(page, info, "vehicle-focus-expanded");
  if (isMobile) {
    await page.getByRole("button", { name: "Collapse journey" }).tap();
    await expect(map).toHaveAttribute("data-camera-state", "VEHICLE_FOCUS");
    await vehicleUnobstructed(map);
    await screenshot(page, info, "vehicle-focus-collapsed");
    await page.getByRole("button", { name: "Expand journey" }).tap();
    await expect(map).toHaveAttribute("data-camera-state", "VEHICLE_FOCUS");
    await vehicleUnobstructed(map);
  }
  const focused = await camera(map);
  await advance(page, movingTimes[0]);
  await expect.poll(() => camera(map)).not.toEqual(focused);
  await expect(map).toHaveAttribute("data-camera-state", "VEHICLE_FOCUS");
  await vehicleUnobstructed(map);
  expect(await map.evaluate((node, old) => node === old, mapNode)).toBe(true);
  expect(await map.getByTitle("Bus T401-01", { exact: true }).locator("svg").evaluate((node, old) => node === old, glyph)).toBe(true);

  await drag(page, map, isMobile);
  await page.clock.setFixedTime(new Date(movingTimes[0] + 1000));
  await controls.getByRole("button", { name: "Return to Vehicle", exact: true }).waitFor();
  await screenshot(page, info, "free-explore-return");
  const free = await camera(map);
  await advance(page, movingTimes[1]);
  await expect.poll(() => camera(map)).toEqual(free);
  await advance(page, movingTimes[2]);
  await expect.poll(() => camera(map)).toEqual(free);
  if (isMobile) {
    await page.getByRole("button", { name: "Collapse journey" }).tap();
    await expect(controls.getByRole("button", { name: "Return to Vehicle", exact: true })).toBeVisible();
    await expect.poll(() => camera(map)).toEqual(free);
    await screenshot(page, info, "collapsed-return");
    await page.getByRole("button", { name: "Expand journey" }).tap();
    await expect(controls.getByRole("button", { name: "Return to Vehicle", exact: true })).toBeVisible();
    await screenshot(page, info, "expanded-return");
  }
  await controls.getByRole("button", { name: "Return to Vehicle", exact: true }).click();
  await expect(map).toHaveAttribute("data-camera-state", "VEHICLE_FOCUS");
  await vehicleUnobstructed(map);
  const returned = await camera(map);
  const later = movingTimes.find(time => time > movingTimes[2] && Math.hypot(busAt(time).position![0] - busAt(movingTimes[2]).position![0], busAt(time).position![1] - busAt(movingTimes[2]).position![1]) > .012)!;
  await advance(page, later);
  await expect.poll(() => camera(map)).not.toEqual(returned);
  await page.getByRole("combobox", { name: "Bus route", exact: true }).selectOption("T402");
  await expect(map).toHaveAttribute("data-camera-state", "OVERVIEW");
  await expect(map.locator(".bus-route-emphasis")).toHaveClass(/bus-route-T402/);
  await drag(page, map, isMobile);
  await page.getByRole("combobox", { name: "Bus route", exact: true }).selectOption("T401");
  await expect(map).toHaveAttribute("data-camera-state", "OVERVIEW");
  await expect(map.locator(".bus-route-emphasis")).toHaveClass(/bus-route-T401/);
  await page.getByRole("combobox", { name: "Bus route", exact: true }).selectOption("");
  await expect(map.locator(".bus-network-route")).toHaveCount(2);
  await expect(map.locator(".bus-route-emphasis")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("wheel, zoom buttons and mobile pinch suspend following without mistaking programmatic focus", async ({ page, isMobile }) => {
  const map = await prepare(page, isMobile);
  await selectBus(page);
  const controls = page.getByRole("group", { name: "Map camera" });
  await controls.getByRole("button", { name: "Locate bus", exact: true }).click();
  await expect(map).toHaveAttribute("data-camera-state", "VEHICLE_FOCUS");
  const beforeZoom = await map.getAttribute("data-camera-zoom");
  if (isMobile) {
    const marker = (await map.getByTitle("Bus T401-01", { exact: true }).boundingBox())!;
    const x = marker.x + marker.width / 2 + 30, y = marker.y + marker.height / 2;
    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x - 30, y, id: 1 }, { x: x + 30, y, id: 2 }] });
    for (let spread = 38; spread <= 70; spread += 8) {
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - spread, y, id: 1 }, { x: x + spread, y, id: 2 }] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await client.detach();
  } else {
    const marker = (await map.getByTitle("Bus T401-01", { exact: true }).boundingBox())!;
    await page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
    await page.mouse.wheel(0, -240);
  }
  await expect(map).toHaveAttribute("data-camera-state", "FREE_EXPLORE");
  await expect(map).not.toHaveAttribute("data-camera-zoom", beforeZoom!);
  await controls.getByRole("button", { name: "Return to Vehicle", exact: true }).click();
  await expect(map).toHaveAttribute("data-camera-state", "VEHICLE_FOCUS");
  const zoom = await map.getAttribute("data-camera-zoom");
  await map.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.clock.setFixedTime(new Date(start + 1000));
  await expect(map).toHaveAttribute("data-camera-state", "FREE_EXPLORE");
  await expect(map).not.toHaveAttribute("data-camera-zoom", zoom!);
  await page.getByRole("button", { name: "Close bus journey" }).click();
  await expect(map).toHaveAttribute("data-camera-state", "OVERVIEW");
});

test("tablet layout exposes camera controls without overflow", async ({ page, isMobile }, info) => {
  test.skip(isMobile, "Tablet is exercised once through the desktop Chromium project");
  const map = await prepare(page, false, { width: 820, height: 1180 });
  await screenshot(page, info, "tablet-overview");
  await selectBus(page);
  const controls = page.getByRole("group", { name: "Map camera" });
  await controls.getByRole("button", { name: "Locate bus", exact: true }).click();
  await expect(map).toHaveAttribute("data-camera-state", "VEHICLE_FOCUS");
  await vehicleUnobstructed(map);
  await screenshot(page, info, "tablet-focus");
  await drag(page, map, false);
  await expect(controls.getByRole("button", { name: "Return to Vehicle", exact: true })).toBeVisible();
  await screenshot(page, info, "tablet-free-explore");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test("unavailable selected bus keeps the view and never switches to another vehicle", async ({ page, isMobile }) => {
  const map = await prepare(page, isMobile);
  await selectBus(page);
  const controls = page.getByRole("group", { name: "Map camera" });
  await controls.getByRole("button", { name: "Locate bus", exact: true }).click();
  await expect(map).toHaveAttribute("data-camera-state", "VEHICLE_FOCUS");
  const search = page.getByRole("textbox", { name: "Search vehicles, routes or stations" });
  await search.fill("Bus T402");
  await expect(map).toHaveAttribute("data-camera-state", "FREE_EXPLORE");
  await expect(controls.getByRole("status")).toContainText("Selected bus unavailable");
  const stable = await camera(map);
  await controls.getByRole("button", { name: "Return to Vehicle", exact: true }).click();
  await expect.poll(() => camera(map)).toEqual(stable);
  await expect(map).toHaveAttribute("data-camera-vehicle", busId);
  await search.fill("");
  await expect(map).toHaveAttribute("data-camera-state", "FREE_EXPLORE");
  await controls.getByRole("button", { name: "Return to Vehicle", exact: true }).click();
  await expect(map).toHaveAttribute("data-camera-state", "VEHICLE_FOCUS");
});


test("selecting a different bus does not transfer following without Return", async ({ page, isMobile }) => {
  const map = await prepare(page, isMobile);
  await selectBus(page);
  const controls = page.getByRole("group", { name: "Map camera" });
  await controls.getByRole("button", { name: "Locate bus", exact: true }).click();
  await expect(map).toHaveAttribute("data-camera-state", "VEHICLE_FOCUS");
  const previous = await camera(map);
  await page.getByRole("row", { name: /^Bus T402-01 / }).getByRole("button", { name: "View details" }).click();
  await expect(map).toHaveAttribute("data-camera-state", "FREE_EXPLORE");
  await expect(map).toHaveAttribute("data-camera-vehicle", "bus:T402:01");
  await expect.poll(() => camera(map)).toEqual(previous);
  await controls.getByRole("button", { name: "Return to Vehicle", exact: true }).click();
  await expect(map).toHaveAttribute("data-camera-state", "VEHICLE_FOCUS");
  await expect(map).toHaveAttribute("data-camera-vehicle", "bus:T402:01");
});


test("closing a focused bus popup keeps the whole vehicle clear of the restored legend", async ({ page, isMobile }) => {
  const map = await prepare(page, isMobile);
  await selectBus(page);
  const controls = page.getByRole("group", { name: "Map camera" });
  await controls.getByRole("button", { name: "Locate bus", exact: true }).click();
  await expect(map).toHaveAttribute("data-camera-state", "VEHICLE_FOCUS");
  const marker = map.getByTitle("Bus T401-01", { exact: true });
  await marker.click();
  await expect(map.locator(".bus-vehicle-popup")).toBeVisible();
  await map.getByRole("button", { name: "Close popup", exact: true }).click();
  await expect(map.locator(".bus-vehicle-popup")).toHaveCount(0);
  await expect(page.getByLabel("Map legend", { exact: true })).toBeVisible();
  await expect(map).toHaveAttribute("data-camera-state", "VEHICLE_FOCUS");
  await expect.poll(() => marker.evaluate(element => {
    const b = element.getBoundingClientRect();
    return [[b.left + 2, b.top + 2], [b.right - 2, b.top + 2], [b.left + 2, b.bottom - 2], [b.right - 2, b.bottom - 2]]
      .every(([x, y]) => element.contains(document.elementFromPoint(x, y)));
  })).toBe(true);
});
