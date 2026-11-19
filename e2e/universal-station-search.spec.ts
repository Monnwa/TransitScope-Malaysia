import { expect, test, type Locator, type Page } from "@playwright/test";
import type { SearchBusStop } from "../lib/bus-stop-search";
import type { MicromobilityStation } from "../lib/micromobility";
import { renderedStationPosition } from "./map-station";

const input = (page: Page) => page.getByRole("textbox", { name: "Search vehicles, routes or stations" });
const map = (page: Page) => page.locator(".leaflet-container");
const markers = (page: Page) => map(page).locator(".linkbike-marker, .micromobility-marker");
const options = (page: Page) => page.getByRole("listbox", { name: "Station search results" }).getByRole("option");

async function prepare(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const micromobility = page.waitForResponse(response => new URL(response.url()).pathname === "/api/micromobility/stations");
  await page.goto("/");
  const response = await micromobility;
  expect(response.ok()).toBe(true);
  const { stations } = await response.json() as { stations: MicromobilityStation[] };
  await expect(markers(page)).toHaveCount(stations.length);
  return stations;
}

async function choose(option: Locator, mobile: boolean) {
  if (mobile) await option.tap();
  else await option.click();
}

async function expectPosition(marker: Locator, position: [number, number]) {
  await expect.poll(async () => {
    try {
      const actual = await renderedStationPosition(marker);
      return Math.max(Math.abs(actual.latitude - position[0]), Math.abs(actual.longitude - position[1]));
    } catch { return Infinity; }
  }).toBeLessThan(0.00005);
}

async function expectReadablePopup(page: Page, popup: Locator) {
  await expect(popup).toHaveCSS("opacity", "1");
  await expect.poll(() => input(page).evaluate(element => {
    const box = element.getBoundingClientRect();
    const zoom = element.closest(".leaflet-container")!.querySelector(".leaflet-control-zoom")!.getBoundingClientRect();
    return Math.max(0, Math.min(box.right, zoom.right) - Math.max(box.left, zoom.left)) *
      Math.max(0, Math.min(box.bottom, zoom.bottom) - Math.max(box.top, zoom.top));
  })).toBe(0);
}

test("rail autocomplete suppresses all micromobility markers and highlights the interchange", async ({ page, isMobile }, info) => {
  await prepare(page);
  await input(page).fill("Tun Razak");
  await expect(markers(page)).toHaveCount(0);
  await choose(options(page).filter({ hasText: /Tun Razak Exchange/ }).filter({ hasText: "Rail station" }).first(), isMobile);
  await expect(page.locator(".rail-station-popup")).toContainText("Tun Razak Exchange");
  await expect(map(page)).toHaveAttribute("data-station-search-id", "rail:tun-razak-exchange:MRT1");
  await expect(map(page)).toHaveAttribute("data-station-search-type", "RAIL_STATION");
  await expect(page.locator('.line-legend[aria-pressed="true"]')).toHaveText([
    "MRT Kajang Line (MRT1)", "MRT Putrajaya Line (MRT2)",
  ]);
  await expect(markers(page)).toHaveCount(0);
  await expectReadablePopup(page, page.locator(".rail-station-popup-shell"));
  await page.screenshot({ path: info.outputPath("rail-search.png") });
  await map(page).getByRole("button", { name: "Close popup" }).click();
  await expect(markers(page)).toHaveCount(0);
  await expect(page.locator('.line-legend[aria-pressed="true"]')).toHaveCount(0);
});

test("static bus search navigates by real stop ID and retains route details", async ({ page, isMobile }, info) => {
  test.setTimeout(60_000);
  const busResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/bus-stops", { timeout: 45_000 });
  await prepare(page);
  const response = await busResponse;
  expect(response.ok()).toBe(true);
  const data = await response.json() as { stops: SearchBusStop[]; unavailable: string[] };
  expect(data.unavailable).not.toContain("rapid-bus-mrtfeeder");
  const stop = data.stops.find(item => item.sourceId === "12003043" && item.routes.some(route => route.name === "T402"));
  expect(stop).toBeDefined();
  await input(page).fill("Taman Midah");
  await expect(options(page).filter({ hasText: "Bus stop" }).first()).toBeVisible();
  await expect(options(page).filter({ hasText: "Rail station" }).first()).toBeVisible();
  await input(page).fill("T401");
  await expect(options(page).first()).toContainText("T401");
  await input(page).fill(stop!.sourceId);
  const option = options(page).filter({ hasText: `Stop ID ${stop!.sourceId}` }).filter({ hasText: "MRT Feeder Bus" });
  if (isMobile) await choose(option, true);
  else {
    await input(page).press("ArrowDown");
    await expect(options(page).first()).toHaveAttribute("aria-selected", "true");
    await input(page).press("Enter");
  }
  const popup = page.locator(".bus-search-popup");
  await expect(popup).toContainText(stop!.name);
  await expect(popup).toContainText(stop!.sourceId);
  await expect(popup).toContainText("T402");
  await expect(map(page)).toHaveAttribute("data-station-search-type", "BUS_STOP");
  await expect(map(page)).toHaveAttribute("data-station-search-id", stop!.id);
  await expectPosition(map(page).locator(".bus-search-stop"), stop!.position);
  await expect(page.locator('.line-legend[aria-pressed="true"]')).toHaveCount(0);
  await expect(markers(page)).toHaveCount(0);
  await expectReadablePopup(page, popup);
  await page.screenshot({ path: info.outputPath("bus-stop-search.png") });
});

test("all micromobility popups open with a single marker and clearing restores operator settings", async ({ page, isMobile }, info) => {
  test.setTimeout(60_000);
  const stations = await prepare(page);
  const hidden = page.getByRole("checkbox", { name: "Show HelloRide" });
  await hidden.uncheck();
  const normallyVisible = stations.filter(station => station.operator !== "HELLORIDE").length;
  await expect(markers(page)).toHaveCount(normallyVisible);
  await input(page).fill("no matching station zz");
  await expect(page.getByText("No matching stations or stops.")).toBeVisible({ timeout: 35_000 });
  await expect(markers(page)).toHaveCount(0);

  for (const [operator, name] of [["LINKBIKE", "LinkBike"], ["HELLORIDE", "HelloRide"], ["TRYKE", "TRYKE"], ["BEAM", "Beam"]] as const) {
    await input(page).fill(name);
    const option = options(page).filter({ hasText: "Micromobility" }).first();
    await expect(option).toBeVisible();
    const stationName = await option.locator("strong").innerText();
    const station = stations.find(item => item.operator === operator && item.name === stationName)!;
    await choose(option, isMobile);
    await expect(map(page)).toHaveAttribute("data-station-search-type", "MICROMOBILITY_STATION");
    await expect(map(page)).toHaveAttribute("data-station-search-operator", operator);
    await expect(map(page)).toHaveAttribute("data-station-search-id", station.id);
    await expect(markers(page)).toHaveCount(1);
    await expectPosition(markers(page), [station.latitude, station.longitude]);
    const popup = page.locator(".micromobility-popup, .linkbike-popup");
    await expect(popup).toContainText(station.name);
    await expect(popup).toContainText("Available bicycles");
    await expect(popup).toContainText("Total docks");
    if (station.simulatedInventory) {
      await expect(popup).toContainText("SIMULATED INVENTORY");
      await expect(popup).toContainText(station.dataOrigin);
      await expect(popup.getByLabel("Simulated inventory").locator("dd")).toHaveText([
        String(station.simulatedInventory.availableBicycles), String(station.simulatedInventory.totalDocks),
      ]);
    }
    const shell = map(page).locator(".leaflet-popup").filter({ has: popup });
    await expectReadablePopup(page, shell);
    if (operator === "BEAM") await page.screenshot({ path: info.outputPath("micromobility-selected.png") });
    await shell.getByRole("button", { name: "Close popup" }).click();
    await expect(markers(page)).toHaveCount(0);
    await expect(map(page).locator(".leaflet-popup")).toHaveCount(0);
    await expect(input(page)).toHaveValue(name);
  }
  const viewport = await map(page).evaluate(element => [
    element.getAttribute("data-camera-latitude"), element.getAttribute("data-camera-longitude"), element.getAttribute("data-camera-zoom"),
  ]);
  await page.getByRole("button", { name: "Clear station search" }).click();
  await expect(markers(page)).toHaveCount(normallyVisible);
  await expect(hidden).not.toBeChecked();
  await expect(page.locator(".micromobility-helloride")).toHaveCount(0);
  expect(await map(page).evaluate(element => [
    element.getAttribute("data-camera-latitude"), element.getAttribute("data-camera-longitude"), element.getAttribute("data-camera-zoom"),
  ])).toEqual(viewport);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await page.screenshot({ path: info.outputPath("search-cleared.png") });
});
