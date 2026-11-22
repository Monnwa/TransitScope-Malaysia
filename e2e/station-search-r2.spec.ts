import { chooseSearchStation } from "./map-station";
import { expect, test, type Page } from "@playwright/test";
import { railNetwork } from "../lib/simulation/network";
import { renderedStationPosition } from "./map-station";

const search = (page: Page) => page.getByRole("textbox", { name: "Search vehicles, routes or stations" });
const popup = (page: Page) => page.locator(".rail-station-popup-shell");
const map = (page: Page) => page.locator(".leaflet-container");
async function prepare(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-11-17T09:41:25Z"));
  await page.route("https://tile.openstreetmap.org/**", route => route.fulfill({ contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#eef1f2" d="M0 0h256v256H0z"/></svg>' }));
  await page.goto("/");
  await expect(map(page)).toHaveAttribute("data-camera-zoom", /\d+/);
}
async function stationPopup(page: Page, name: string) {
  await expect(popup(page)).toHaveCount(1);
  await expect(popup(page).locator("strong")).toHaveText(name);
  await expect(popup(page)).toHaveCSS("opacity", "1");
  await expect(popup(page)).not.toHaveAttribute("data-rail-presentation-conflict", /.+/);
}

test("exact unique TRX text automatically navigates and opens the native popup", async ({ page, isMobile }, info) => {
  await page.setViewportSize(isMobile ? { width: 375, height: 844 } : { width: 1101, height: 830 });
  await prepare(page);
  const before = await map(page).getAttribute("data-camera-zoom");
  await search(page).fill("Tun Razak Exchange");
  await stationPopup(page, "Tun Razak Exchange");
  await expect(map(page)).toHaveAttribute("data-station-search-id", "rail:tun-razak-exchange:MRT1");
  await expect(map(page)).toHaveAttribute("data-camera-zoom", "17");
  await expect(map(page).locator(".rail-station")).toHaveCount(1);
  const position = await renderedStationPosition(map(page).locator(".rail-station"));
  const canonical = railNetwork.stations.find(station => station.name === "Tun Razak Exchange")!;
  expect(position.latitude).toBeCloseTo(canonical.position![0], 4);
  expect(position.longitude).toBeCloseTo(canonical.position![1], 4);
  expect(before).not.toBe("17");
  await expect(popup(page)).toContainText("MRT Kajang Line (MRT1)");
  await expect(popup(page)).toContainText("MRT Putrajaya Line (MRT2)");
  await expect.poll(() => popup(page).evaluate(element => {
    const bubble = element.getBoundingClientRect(), input = document.querySelector(".map-search")!.getBoundingClientRect();
    return Math.max(0, Math.min(bubble.right, input.right) - Math.max(bubble.left, input.left)) *
      Math.max(0, Math.min(bubble.bottom, input.bottom) - Math.max(bubble.top, input.top));
  })).toBe(0);
  await page.screenshot({ path: info.outputPath("exact-trx.png") });
});

test("Selecting an autocomplete result navigates and opens its popup", async ({ page }) => {
  await prepare(page);
  await chooseSearchStation(page, "Tun Razak Exchange");
  await stationPopup(page, "Tun Razak Exchange");
  await expect(map(page)).toHaveAttribute("data-camera-zoom", "17");
});

test("partial text leaves the camera alone until the user selects a result", async ({ page }) => {
  await prepare(page);
  await map(page).scrollIntoViewIfNeeded();
  // The bus overview is south of the initial map centre and can keep its zoom.
  await expect.poll(async () => Number(await map(page).getAttribute("data-camera-latitude") ?? "NaN")).toBeLessThan(3.14);
  const camera = () => map(page).evaluate(element => [
    element.getAttribute("data-camera-latitude"),
    element.getAttribute("data-camera-longitude"),
    element.getAttribute("data-camera-zoom"),
  ]);
  const before = await camera();
  await search(page).fill("Tun Razak");
  await expect(page.getByRole("listbox").getByText("Tun Razak Exchange", { exact: true })).toHaveCount(1);
  await expect(popup(page)).toHaveCount(0);
  expect(await camera()).toEqual(before);
  await chooseSearchStation(page, "Tun Razak Exchange");
  await stationPopup(page, "Tun Razak Exchange");
});

test("normalized exact input, partial results, clearing and another station share the same workflow", async ({ page }) => {
  await prepare(page);
  await search(page).fill("  tUn   RaZaK  eXcHaNgE  ");
  await stationPopup(page, "Tun Razak Exchange");
  await popup(page).getByRole("button", { name: "Close popup" }).click();
  await expect(popup(page)).toHaveCount(0);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const focused = await map(page).evaluate(element => [element.getAttribute("data-camera-latitude"), element.getAttribute("data-camera-longitude"), element.getAttribute("data-camera-zoom")]);
  await search(page).fill("Sentral");
  expect(await page.getByRole("listbox").getByRole("option").count()).toBeGreaterThan(1);
  await expect(popup(page)).toHaveCount(0);
  expect(await map(page).evaluate(element => [element.getAttribute("data-camera-latitude"), element.getAttribute("data-camera-longitude"), element.getAttribute("data-camera-zoom")])).toEqual(focused);
  await search(page).fill("");
  await expect(popup(page)).toHaveCount(0);
  await chooseSearchStation(page, "Taman Midah");
  await stationPopup(page, "Taman Midah");
});

test("rapid successive exact searches retire the earlier station and repeated search reopens", async ({ page }) => {
  await prepare(page);
  await search(page).fill("Tun Razak Exchange");
  await search(page).fill("Taman Midah");
  await stationPopup(page, "Taman Midah");
  await expect(map(page)).toHaveAttribute("data-station-search-id", "rail:taman-midah:MRT1");
  await popup(page).getByRole("button", { name: "Close popup" }).click();
  await expect(popup(page)).toHaveCount(0);
  await search(page).fill("");
  await search(page).fill("Taman Midah");
  await stationPopup(page, "Taman Midah");
});

test("existing station aliases and station-name prefixes resolve through the canonical record", async ({ page }) => {
  await prepare(page);
  await search(page).fill("TBS");
  await stationPopup(page, "Bandar Tasik Selatan");
  await search(page).fill("MRT Tun Razak Exchange station");
  await stationPopup(page, "Tun Razak Exchange");
});

test("Overview retires the station popup before fitting the bus network", async ({ page }) => {
  await prepare(page);
  await search(page).fill("Rawang");
  await stationPopup(page, "Rawang");
  await page.getByRole("group", { name: "Map camera" }).getByRole("button", { name: "Overview", exact: true }).click();
  await expect(popup(page)).toHaveCount(0);
  await expect(map(page)).toHaveAttribute("data-camera-intent", "bus");
  expect(Number(await map(page).getAttribute("data-camera-latitude"))).toBeGreaterThan(3);
  expect(Number(await map(page).getAttribute("data-camera-latitude"))).toBeLessThan(3.25);
  expect(Number(await map(page).getAttribute("data-camera-zoom"))).toBeLessThanOrEqual(14);
});
