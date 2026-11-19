import { expect, test, type Locator, type Page } from "@playwright/test";
import { busRecords } from "../lib/simulation/vehicles";
import { railNetwork } from "../lib/simulation/network";
import { renderedStationPosition } from "./map-station";

const start = Date.parse("2026-11-14T04:00:00Z");
async function frames(page: Page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function prepare(page: Page, mobile: boolean) {
  await page.setViewportSize(mobile ? { width: 375, height: 844 } : { width: 1265, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.clock.setFixedTime(new Date(start));
  const external: string[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "tile.openstreetmap.org") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#eff2f0" d="M0 0h256v256H0z"/></svg>' });
    if (url.hostname === "127.0.0.1" && !url.pathname.startsWith("/api/")) return route.continue();
    external.push(url.href); return route.abort();
  });
  await page.goto("/"); const map = page.locator(".leaflet-container");
  await expect(map).toHaveAttribute("data-camera-state", "OVERVIEW");
  await page.locator(".map-camera-frame").scrollIntoViewIfNeeded(); await frames(page);
  return { map, external };
}
const camera = (map: Locator) => map.evaluate(element => ({ latitude: element.getAttribute("data-camera-latitude"), longitude: element.getAttribute("data-camera-longitude"), zoom: element.getAttribute("data-camera-zoom") }));
async function focus(page: Page, map: Locator) {
  await page.getByRole("row", { name: /^Bus T401-01 / }).getByRole("button", { name: "View details" }).click();
  const controls = page.getByRole("group", { name: "Map camera" });
  await controls.getByRole("button", { name: /Locate bus|Return to Vehicle/ }).click();
  await expect(map).toHaveAttribute("data-camera-state", "VEHICLE_FOCUS"); await frames(page);
  return controls;
}
async function network(map: Locator) {
  await map.page().locator(".map-camera-frame").evaluate(element => element.scrollIntoView({ block: "start", behavior: "instant" })); await frames(map.page());
  await expect(map).toHaveAttribute("data-camera-state", "OVERVIEW"); await expect(map).toHaveAttribute("data-camera-intent", "bus");
  expect(Number(await map.getAttribute("data-camera-latitude"))).toBeGreaterThan(3);
  expect(Number(await map.getAttribute("data-camera-latitude"))).toBeLessThan(3.25);
  expect(Number(await map.getAttribute("data-camera-zoom"))).toBeLessThanOrEqual(14);
}

test("rail selection survives layout and manual exploration, while clear, Overview, route and reset remain explicit", async ({ page, isMobile }, info) => {
  const { map, external } = await prepare(page, isMobile);
  for (const [name, latitude, longitude] of [["Tanjung Malim", 3.685, 101.524], ["Rawang", 3.321, 101.576]] as const) {
    await focus(page, map);
    await page.getByRole("row", { name: new RegExp("^" + name + " ") }).getByRole("button", { name: "View details" }).click();
    await map.scrollIntoViewIfNeeded(); await frames(page);
    await expect(map).toHaveAttribute("data-camera-state", "OVERVIEW"); await expect(map).toHaveAttribute("data-camera-intent", "selection");
    await expect(map.locator(".rail-station-popup")).toHaveCount(1);
    await expect(map.locator(".rail-station-popup strong")).toHaveText(name);
    // The camera now reserves space for the automatic popup; verify the actual station point instead of the offset camera center.
    const index = railNetwork.stations.findIndex(station => station.name === name);
    const point = await renderedStationPosition(map.locator(".rail-station").nth(index));
    expect(point.latitude).toBeCloseTo(latitude, 4);
    expect(point.longitude).toBeCloseTo(longitude, 4);
    const selectedView = await camera(map);
    await page.evaluate(() => { window.dispatchEvent(new Event("scroll")); window.dispatchEvent(new Event("resize")); }); await frames(page);
    expect(await camera(map)).toEqual(selectedView);
  }
  await page.screenshot({ path: info.outputPath("rail-selection-synthetic-tiles.png"), scale: "css" });
  await map.focus(); await map.press("ArrowRight"); await page.clock.setFixedTime(new Date(start + 1000)); await frames(page);
  await expect(map).toHaveAttribute("data-camera-state", "FREE_EXPLORE"); const explored = await camera(map);
  await page.evaluate(() => window.dispatchEvent(new Event("resize"))); await frames(page); expect(await camera(map)).toEqual(explored);
  await page.getByRole("group", { name: "Map camera" }).getByRole("button", { name: "Overview", exact: true }).click(); await frames(page); await network(map);
  await focus(page, map); await page.getByRole("button", { name: "Close bus journey" }).click(); await frames(page); await network(map);
  for (const id of ["T402", ""]) {
    await page.getByRole("combobox", { name: "Bus route", exact: true }).selectOption(id); await frames(page); await network(map);
    await expect(map).toHaveAttribute("data-bus-route", id);
  }
  await focus(page, map); await page.getByRole("button", { name: "Fit to region", exact: true }).click(); await frames(page); await network(map);
  expect(external).toEqual([]);
});

test("native shifted zoom and arrow keys suspend following until explicit Return", async ({ page, isMobile }, info) => {
  const { map, external } = await prepare(page, isMobile); const controls = await focus(page, map);
  const times = Array.from({ length: 180 }, (_, n) => start + (n + 1) * 5000).filter(time => {
    const point = busRecords(time).find(bus => bus.id === "bus:T401:01")!.position!;
    return Math.hypot(point[0] - 3.13, point[1] - 101.72) > .01;
  });
  let step = 0, now = start;
  for (const key of ["Shift+Minus", "Minus", "Shift+Equal", "ArrowRight"]) {
    const previous = await camera(map); await map.focus(); await map.press(key);
    await expect(map).toHaveAttribute("data-camera-state", "FREE_EXPLORE");
    // Finish Leaflet's Date-based user animation, separately from simulation progression.
    await page.clock.setFixedTime(new Date(now += 1000)); await frames(page);
    await expect.poll(() => camera(map)).not.toEqual(previous); const manual = await camera(map);
    const time = Math.max(now + 5000, times[++step * 3]); now = time; await page.clock.setFixedTime(new Date(time));
    const coordinates = busRecords(time).find(bus => bus.id === "bus:T401:01")!.position!.map(value => value.toFixed(5)).join(", ");
    await expect(page.locator(".bus-technical .details dd").filter({ hasText: coordinates })).toHaveCount(1);
    await frames(page); expect(await camera(map)).toEqual(manual);
    await controls.getByRole("button", { name: "Return to Vehicle", exact: true }).click(); await expect(map).toHaveAttribute("data-camera-state", "VEHICLE_FOCUS");
  }
  await page.screenshot({ path: info.outputPath("keyboard-return-synthetic-tiles.png"), scale: "css" });
  expect(external).toEqual([]);
});
