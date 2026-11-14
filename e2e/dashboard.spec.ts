import { expect, test, type Page } from "@playwright/test";

async function watchDashboard(page: Page, baseURL: string) {
  const unexpectedRequests: string[] = [];
  const errors: string[] = [];
  const origin = new URL(baseURL).origin;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (/^(?:[abc]\.)?tile\.openstreetmap\.org$/.test(url.hostname)) {
      // Stand in for map tiles so the smoke test works offline.
      return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>' });
    }
    if (url.origin === origin && !url.pathname.startsWith("/api/")) return route.continue();
    unexpectedRequests.push(url.href);
    return route.abort();
  });
  return () => {
    expect(unexpectedRequests).toEqual([]);
    expect(errors).toEqual([]);
  };
}

test("dashboard shares simulated data across overlays, details and filters", async ({ page, baseURL }) => {
  const checkDashboard = await watchDashboard(page, baseURL!);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-11-14T04:00:00.000Z"));
  await page.goto("/?mode=live");
  await expect(page.getByText("SIMULATION MODE", { exact: true })).toBeVisible();
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.locator(".rail-alignment")).toHaveCount(8);
  await expect(page.locator(".recharts-surface")).toHaveCount(2);
  await expect(page.locator("#records tbody td:nth-child(5)").first()).toHaveText("SIMULATED");

  const search = page.getByRole("textbox", { name: "Search vehicles, routes or stations" });
  await search.fill("Bus D100-01");
  const row = page.getByRole("row", { name: /Bus D100-01/ });
  const marker = page.getByTitle("Bus D100-01", { exact: true });
  await expect(row).toBeVisible();
  await marker.evaluate(element => (element as HTMLElement).click());
  const bus = page.getByRole("region", { name: "Bus journey detail" });
  await expect(bus.getByRole("heading", { name: /Bus D100-01/ })).toBeVisible();
  await expect(marker).toHaveClass(/vehicle-selected/);
  await expect(bus.getByRole("progressbar")).toBeVisible();
  await bus.locator(".bus-stop-control").last().click();
  await expect(page.locator(".journey-stop-popup")).toContainText("SIMULATED");
  await bus.getByRole("button", { name: /Upcoming departure/ }).first().click();
  await expect(page.locator(".selected-vehicle-route")).toHaveCount(1);
  await bus.getByRole("button", { name: /Locate bus/ }).click();
  await expect(page.locator(".gps-route-remaining")).toHaveCount(1);
  const map = page.locator(".leaflet-container");
  await expect(map).toHaveAttribute("data-focused-latitude", /\d/);
  const lat = Number(await map.getAttribute("data-focused-latitude"));
  const lng = Number(await map.getAttribute("data-focused-longitude"));
  await bus.getByText("Technical information", { exact: true }).click();
  await expect(bus.getByText(`${lat.toFixed(5)}, ${lng.toFixed(5)}`, { exact: true })).toBeVisible();
  await bus.getByRole("button", { name: "Close bus journey" }).click();

  await search.fill("");
  await page.getByRole("button", { name: "Bandar Tasik Selatan status" }).click();
  const detail = page.getByRole("complementary", { name: "Selected transport detail" });
  await expect(detail.getByRole("heading", { name: "Station operations" })).toBeVisible();
  const board = detail.getByRole("region", { name: "Upcoming Departures" });
  await expect(board.getByRole("listitem")).toHaveCount(5);
  await board.getByRole("button", { name: "Show all services" }).click();
  await expect(board.getByRole("listitem")).toHaveCount(8);
  await board.getByRole("combobox", { name: "Service" }).selectOption("KTM:KC05_KB18");
  await expect(board.getByRole("listitem").first()).toContainText("KTM Batu Caves–Pulau Sebang");
  await board.getByRole("button", { name: "Refresh departures" }).click();

  await expect(page.locator(".rail-alignment.MRT1")).toHaveAttribute("stroke", "#006B3F");
  await expect(page.locator(".rail-alignment.MRT2")).toHaveAttribute("stroke", "#F2C500");
  const rail = page.getByRole("checkbox", { name: "Show MRT Kajang Line (MRT1)", exact: true });
  await rail.uncheck();
  await expect(page.locator(".rail-alignment.MRT1")).toHaveCount(0);
  await rail.check();
  await page.getByRole("checkbox", { name: "Show simulated train positions" }).check();
  await expect(page.locator(".estimated-train-icon").first()).toBeAttached();
  await search.fill("Train MRT1-01");
  await page.getByRole("button", { name: "View details" }).click();
  const trainPanel = detail.getByRole("region", { name: "Simulated train information" });
  await expect(trainPanel).toContainText("Train MRT1-01");
  await trainPanel.getByRole("button", { name: "Close simulated train" }).click();
  await expect(trainPanel).toBeHidden();

  await search.fill("");
  await page.getByRole("button", { name: "Shared bike", exact: true }).click();
  await expect(page.locator("#records tbody tr")).toHaveCount(27);
  await page.getByRole("checkbox", { name: "Show LinkBike stations" }).check();
  await page.getByRole("button", { name: "Zoom to LinkBike stations" }).click();
  await expect(page.locator(".linkbike-marker")).toHaveCount(27);
  await page.getByRole("region", { name: "LinkBike station details" }).waitFor({ state: "hidden" });
  await page.locator(".leaflet-container").scrollIntoViewIfNeeded();
  const markers = page.locator(".linkbike-marker");
  let hitIndex = -1;
  await expect.poll(async () => {
    hitIndex = await markers.evaluateAll(elements => elements.findIndex(element => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return hit !== null && element.contains(hit);
    }));
    return hitIndex;
  }).toBeGreaterThanOrEqual(0);
  const markerTarget = markers.nth(hitIndex);
  await expect(markerTarget).toBeVisible();
  const stationName = (await markerTarget.getAttribute("title"))?.replace(/^LinkBike: /, "");
  expect(stationName).toBeTruthy();
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) await markerTarget.tap();
  else await markerTarget.click();
  const popup = page.getByRole("region", { name: "LinkBike station details" });
  await expect(popup.getByRole("heading")).toHaveText(stationName!);
  await expect(popup).toContainText("SIMULATED");
  await expect(popup.locator("dt")).toHaveText(["Available bicycles", "Total docks"]);

  await page.getByRole("combobox", { name: "Filter alerts" }).selectOption("Restoration");
  await page.getByRole("button", { name: /D100 service restored/ }).click();
  await expect(page.getByRole("dialog", { name: "Alert detail" })).toContainText("SIMULATED");
  checkDashboard();
});

test("mobile dashboard keeps the bus sheet and horizontal layout usable", async ({ page, baseURL }) => {
  const checkDashboard = await watchDashboard(page, baseURL!);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await page.getByRole("textbox", { name: "Search vehicles, routes or stations" }).fill("Bus D100-01");
  await page.getByRole("button", { name: "View details" }).click();
  await page.getByRole("button", { name: "Collapse journey" }).click();
  await expect(page.getByRole("button", { name: "Expand journey" })).toBeVisible();
  await page.getByRole("button", { name: "Expand journey" }).click();
  await expect(page.getByRole("list", { name: "Bus stops" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  checkDashboard();
});
