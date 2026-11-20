import { expect, test, type Locator, type Page } from "@playwright/test";

const time = Date.parse("2026-11-14T04:00:00Z");
async function prepare(page: Page, mobile: boolean, failTiles = false) {
  await page.setViewportSize(mobile ? { width: 375, height: 844 } : { width: 1265, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date(time));
  await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, route => failTiles ? route.abort() : route.fulfill({
    contentType: "image/svg+xml",
    // Synthetic tiles validate overlays/layout only, not provider cartography.
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#e9eee8" d="M0 0h256v256H0z"/><path stroke="#c3c8c3" fill="none" d="M0 80h256M60 0v256M0 210h256M200 0v256"/></svg>',
  }));
  await page.goto("/");
  const map = page.locator(".leaflet-container");
  await expect(map.locator(".bus-network-route")).toHaveCount(2);
  await map.scrollIntoViewIfNeeded();
  return map;
}
async function fitsMap(map: Locator, route: Locator) {
  await expect.poll(async () => {
    const [outer, inner] = await Promise.all([map.boundingBox(), route.boundingBox()]);
    return !!outer && !!inner && inner.x >= outer.x && inner.y >= outer.y &&
      inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
  }).toBe(true);
}

test("frames the network, switches complete routes, and restores overview without following updates", async ({ page, isMobile }, info) => {
  const map = await prepare(page, isMobile);
  await expect(map).toHaveAttribute("data-bus-view", "OVERVIEW");
  await expect(map.locator(".bus-route-emphasis")).toHaveCount(0);
  await expect(map.locator(".bus-vehicle-icon")).toHaveCount(8);
  await expect(map.locator(".rail-alignment")).toHaveCount(11);
  await expect(map.locator(".leaflet-control-attribution")).toContainText("OpenStreetMap");
  await fitsMap(map, map.locator(".bus-network-route.bus-route-T401"));
  await fitsMap(map, map.locator(".bus-network-route.bus-route-T402"));
  await page.screenshot({ path: info.outputPath("overview-mocked-tiles.png") });
  const geometry = map.locator(".bus-network-route.bus-route-T401");
  const oldPath = await geometry.elementHandle();
  const initialD = await geometry.getAttribute("d");
  await page.clock.setFixedTime(new Date(time + 5000));
  await expect(page.locator("header .fresh")).toContainText("12:00:05");
  await expect(geometry).toHaveAttribute("d", initialD!);
  expect(await geometry.evaluate((element, old) => element === old, oldPath)).toBe(true);

  const select = page.getByRole("combobox", { name: "Bus route" });
  for (const id of ["T401", "T402"]) {
    await select.selectOption(id);
    await expect(map).toHaveAttribute("data-bus-route", id);
    await expect(map).toHaveAttribute("data-bus-view", "ROUTE");
    await expect(map.locator(".bus-route-emphasis")).toHaveClass(new RegExp("bus-route-" + id));
    await expect(map.locator(".bus-network-route")).toHaveCount(1);
    await expect(map.locator(".bus-network-route")).toHaveClass(new RegExp("bus-route-" + id));
    await expect(map.locator(".bus-network-route").first()).toHaveAttribute("stroke-opacity", "0.24");
    await fitsMap(map, map.locator(".bus-route-emphasis"));
    await map.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(id + "-mocked-tiles.png") });
  }
  await select.selectOption("");
  await expect(map).toHaveAttribute("data-bus-view", "OVERVIEW");
  await expect(map.locator(".bus-route-emphasis")).toHaveCount(0);
  await expect(map.locator(".bus-network-route").first()).toHaveAttribute("stroke-opacity", "0.65");
  await fitsMap(map, geometry);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("tile failure preserves route, vehicle, popup and dismissal interactions", async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const map = await prepare(page, isMobile, true);
  await expect(map.locator('.leaflet-tile-loaded[src^="data:image/svg+xml"]')).not.toHaveCount(0);
  await page.getByRole("row", { name: /^Bus T401-01 / }).getByRole("button", { name: "View details" }).click();
  await expect(map.getByTitle("Bus T401-01", { exact: true })).toHaveClass(/vehicle-selected/);
  await expect(map.locator(".gps-route-remaining")).toHaveCount(1);
  await expect(map.locator(".bus-journey-stop")).not.toHaveCount(0);
  await page.getByRole("button", { name: "Close bus journey" }).click();
  await expect(map.locator(".bus-journey-stop")).toHaveCount(0);
  await expect(map.locator(".bus-network-route")).toHaveCount(2);
  expect(errors).toEqual([]);
});
