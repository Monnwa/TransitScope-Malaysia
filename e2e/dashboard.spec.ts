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
    if (url.origin === origin && (!url.pathname.startsWith("/api/") ||
      ["/api/micromobility/stations", "/api/bus-stops"].includes(url.pathname))) return route.continue();
    unexpectedRequests.push(url.href);
    return route.abort();
  });
  return () => {
    expect(unexpectedRequests).toEqual([]);
    expect(errors).toEqual([]);
  };
}

test("train and LinkBike layers render by default and respect dashboard filters", async ({ page, baseURL }, testInfo) => {
  const checkDashboard = await watchDashboard(page, baseURL!);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-11-14T04:00:00.000Z"));
  await page.goto("/");
  const map = page.locator(".leaflet-container");
  await expect(map).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Show simulated train positions" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Show LinkBike stations" })).toHaveCount(0);
  await expect(map.locator(".estimated-train-icon")).not.toHaveCount(0);
  // Bike stations are in Penang, outside the initial Klang Valley camera view.
  // Their actual marker elements must already exist without a toggle or zoom action.
  await expect(map.locator(".linkbike-marker")).toHaveCount(27);
  await expect(map.locator(".micromobility-marker")).toHaveCount(48);
  await expect(page.getByRole("region", { name: "Simulated train positions" }).getByRole("status")).toContainText("simulated trains displayed");
  await page.locator(".rail-map-group").screenshot({ path: testInfo.outputPath("default-map-layers.png") });

  const search = page.getByRole("textbox", { name: "Search vehicles, routes or stations" });
  await search.fill("Train MRT1-01");
  await expect(map.locator(".estimated-train-icon")).toHaveCount(1);
  await expect(map.locator(".linkbike-marker")).toHaveCount(0);
  await expect(map.locator(".rail-alignment")).toHaveCount(11);
  await search.fill("");
  await page.getByRole("button", { name: "Shared bike", exact: true }).click();
  await expect(map.locator(".estimated-train-icon")).not.toHaveCount(0);
  await expect(map.locator(".linkbike-marker, .micromobility-marker")).toHaveCount(0);
  await page.getByRole("button", { name: "Reset dashboard" }).click();
  await expect(map.locator(".estimated-train-icon")).not.toHaveCount(0);
  await expect(map.locator(".linkbike-marker")).toHaveCount(27);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  checkDashboard();
});

test("dashboard shares simulated data across overlays, details and filters", async ({ page, baseURL }) => {
  const checkDashboard = await watchDashboard(page, baseURL!);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-11-14T04:00:00.000Z"));
  await page.goto("/?mode=live");
  await expect(page.getByText("SIMULATION MODE", { exact: true })).toBeVisible();
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.locator(".rail-alignment")).toHaveCount(11);
  const charts = page.getByRole("region", { name: "Data visualisations" });
  await expect(charts.getByRole("heading", { name: "Transport by mode" })).toBeVisible();
  await expect(charts.locator(".recharts-surface")).toHaveCount(1);
  await expect(page.locator("#records tbody td:nth-child(5)").first()).toHaveText("SIMULATED");

  const search = page.getByRole("textbox", { name: "Search vehicles, routes or stations" });
  const routeSelect = page.getByRole("combobox", { name: "Bus route" });
  await expect(routeSelect.locator("option")).toHaveText(["All routes", "T401", "T402", "BRT Sunway Line"]);
  await expect(page.locator("#about")).toContainText("T401 30 min · T402 30 min");
  for (const name of ["MRT", "LRT", "Monorail", "KTM", "ERL", "Shared bike"]) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  await routeSelect.selectOption("T402");
  const indicators = page.getByRole("region", { name: "Transport indicators" });
  await expect(indicators.locator(".kpi").filter({ hasText: "Vehicles" }).locator("strong")).toHaveText("2");
  await expect(indicators.locator(".kpi").filter({ hasText: "Routes" }).locator("strong")).toHaveText("1");
  await expect(page.locator("#records tbody tr")).toHaveCount(38);
  await expect(page.getByRole("row", { name: /Bus T402-01/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Bus T401-01/ })).toHaveCount(0);
  await expect(page.getByTitle("Bus T401-01", { exact: true })).toHaveCount(0);
  const origin = page.getByRole("row", { name: /MRT TAMAN MIDAH PINTU A/ });
  await origin.getByRole("button", { name: "View details" }).click();
  const t402Board = page.getByRole("region", { name: "Upcoming Departures" });
  await expect(t402Board.getByRole("listitem").first()).toContainText("T402");
  await expect(t402Board.getByRole("listitem").first()).toContainText("SIMULATED");
  await expect(t402Board.getByRole("listitem").first().locator("time")).toHaveAttribute("datetime", "2026-11-14T04:00:00.000Z");
  await page.getByRole("button", { name: "Reset dashboard" }).click();
  await search.fill("Bus T401-01");
  const row = page.getByRole("row", { name: /Bus T401-01/ });
  const marker = page.getByTitle("Bus T401-01", { exact: true });
  await expect(row).toBeVisible();
  await marker.evaluate(element => (element as HTMLElement).click());
  const bus = page.getByRole("region", { name: "Bus journey detail" });
  await expect(bus.getByRole("heading", { name: /Bus T401-01/ })).toBeVisible();
  await expect(marker).toHaveClass(/vehicle-selected/);
  await expect(bus.getByRole("progressbar")).toBeVisible();
  await bus.locator(".bus-stop-control").last().click();
  await expect(page.locator(".journey-stop-popup")).toContainText("SIMULATED");
  const preview = bus.getByRole("button", { name: /Upcoming departure/ }).first();
  await preview.click();
  await expect(preview).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".selected-vehicle-route")).toHaveCount(1);
  await bus.getByRole("button", { name: /Locate bus|Return to Vehicle/ }).click();
  await expect(page.locator(".gps-route-remaining")).toHaveCount(1);
  const map = page.locator(".leaflet-container");
  await expect(map).toHaveAttribute("data-focused-latitude", /\d/);
  const lat = Number(await map.getAttribute("data-focused-latitude"));
  const lng = Number(await map.getAttribute("data-focused-longitude"));
  await bus.getByText("Technical information", { exact: true }).click();
  await expect(bus.getByText(`${lat.toFixed(5)}, ${lng.toFixed(5)}`, { exact: true })).toBeVisible();
  await bus.getByRole("button", { name: "Close bus journey" }).click();

  await expect(page.getByRole("button", { name: "Bandar Tasik Selatan status", exact: true })).toHaveCount(0);
  await search.fill("Bandar Tasik Sel");
  await page.getByRole("listbox", { name: "Station search results" }).getByRole("option")
    .filter({ has: page.getByText("Bandar Tasik Selatan", { exact: true }) }).click();
  const detail = page.getByRole("complementary", { name: "Selected transport detail" });
  await expect(detail.getByRole("heading", { name: "Station operations" })).toBeVisible();
  const board = detail.getByRole("region", { name: "Upcoming Departures" });
  await expect(board.getByRole("listitem")).toHaveCount(5);
  await board.getByRole("button", { name: "Show all services" }).click();
  await expect(board.getByRole("listitem")).toHaveCount(8);
  await board.getByRole("combobox", { name: "Service" }).selectOption("KTM:KC05_KB18");
  await expect(board.getByRole("listitem").first()).toContainText("KTM Batu Caves–Pulau Sebang");
  await board.getByRole("button", { name: "Refresh departures" }).click();
  await search.fill("");

  await expect(page.locator(".rail-alignment.MRT1")).toHaveAttribute("stroke", "#006B3F");
  await expect(page.locator(".rail-alignment.MRT2")).toHaveAttribute("stroke", "#F2C500");
  await expect(page.locator(".rail-map-group").getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Show simulated train positions" })).toHaveCount(0);
  await expect(page.locator(".estimated-train-icon").first()).toBeAttached();
  await search.fill("Train MRT1-01");
  await page.getByRole("button", { name: "View details" }).click();
  const trainPanel = detail.getByRole("region", { name: "Simulated train information" });
  await expect(trainPanel).toContainText("Train MRT1-01");
  await trainPanel.getByRole("button", { name: "Close simulated train" }).click();
  await expect(trainPanel).toBeHidden();

  await search.fill("");
  for (const name of ["Bus", "MRT", "LRT", "Monorail", "KTM", "ERL"]) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  await expect(page.locator("#records tbody tr")).toHaveCount(27);
  await expect(page.getByRole("checkbox", { name: "Show LinkBike stations" })).toHaveCount(0);
  await search.fill("Esplanade Central");
  await page.getByRole("listbox", { name: "Station search results" }).getByRole("option", { name: /Esplanade Central/ }).click();
  await expect(page.getByRole("region", { name: "LinkBike station details" })).toBeVisible();
  await map.getByRole("button", { name: "Close popup", exact: true }).click();
  await page.getByRole("button", { name: "Clear station search" }).click();
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

  await page.getByRole("button", { name: "Reset dashboard" }).click();
  const serviceUpdates = page.getByRole("button", { name: "Service updates" });
  await serviceUpdates.click();
  await page.getByRole("combobox", { name: "Filter alerts" }).selectOption("Delay");
  await expect(serviceUpdates).toContainText("Simulated notices");
  await expect(page.getByRole("region", { name: "Service alerts" }).getByRole("heading", { level: 3 }))
    .toHaveText("Longer waits on the Kajang Line");
  checkDashboard();
});

test("mobile dashboard keeps the bus sheet and horizontal layout usable", async ({ page, baseURL }) => {
  const checkDashboard = await watchDashboard(page, baseURL!);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await page.getByRole("textbox", { name: "Search vehicles, routes or stations" }).fill("Bus T401-01");
  await page.getByRole("button", { name: "View details" }).click();
  await page.getByRole("button", { name: "Collapse journey" }).click();
  await expect(page.getByRole("button", { name: "Expand journey" })).toBeVisible();
  await page.getByRole("button", { name: "Expand journey" }).click();
  await expect(page.getByRole("list", { name: "Bus stops" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  checkDashboard();
});

test("map search fits the map and preserves keyboard, dragging and zoom controls", async ({ page, baseURL }, testInfo) => {
  const checkDashboard = await watchDashboard(page, baseURL!);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const wrap = page.locator(".map-wrap");
  const search = wrap.getByRole("textbox", { name: "Search vehicles, routes or stations" });
  const map = wrap.locator(".leaflet-container");
  await expect(map).toBeVisible();
  await search.scrollIntoViewIfNeeded();
  await expect(page.locator("header input")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Search vehicles, routes or stations" })).toHaveCount(1);

  const bounds = await wrap.boundingBox();
  const inputBounds = await search.boundingBox();
  const zoomBounds = await wrap.locator(".leaflet-control-zoom").boundingBox();
  expect(bounds).not.toBeNull();
  expect(inputBounds).not.toBeNull();
  expect(zoomBounds).not.toBeNull();
  const mobile = page.viewportSize()!.width <= 720;
  const inset = mobile ? 12 : 16;
  expect(inputBounds!.x - bounds!.x).toBeCloseTo(inset, 0);
  expect(inputBounds!.y - bounds!.y).toBeCloseTo(inset, 0);
  expect(inputBounds!.width).toBeCloseTo(mobile ? bounds!.width - 24 : Math.min(400, bounds!.width - 32), 0);
  expect(zoomBounds!.y).toBeGreaterThan(inputBounds!.y + inputBounds!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const pane = map.locator(".leaflet-map-pane");
  const transform = await pane.getAttribute("style");
  await search.fill("T402");
  await search.press("Home");
  await search.press("ArrowRight");
  await search.press("ArrowDown");
  await expect(pane).toHaveAttribute("style", transform!);
  await expect(page.locator("#records tbody tr")).not.toHaveCount(0);
  await expect(page.locator("#records tbody")).not.toContainText("Bus T401-01");
  await search.press("ControlOrMeta+a");
  await search.press("Backspace");
  await expect(search).toHaveValue("");
  await expect(page.getByRole("row", { name: /Bus T401-01/ })).toBeAttached();

  // Drag an unobstructed part of the map, outside the input.
  await map.scrollIntoViewIfNeeded();
  const mapBounds = (await map.boundingBox())!;
  await page.mouse.move(mapBounds.x + mapBounds.width * .8, mapBounds.y + mapBounds.height * .65);
  await page.mouse.down();
  await page.mouse.move(mapBounds.x + mapBounds.width * .8 - 65, mapBounds.y + mapBounds.height * .65 - 45, { steps: 12 });
  await page.mouse.up();
  await expect(pane).not.toHaveAttribute("style", transform!);
  const proxy = map.locator(".leaflet-proxy");
  const beforeZoom = await proxy.getAttribute("style");
  await map.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(proxy).not.toHaveAttribute("style", beforeZoom!);
  await expect.poll(async () => {
    const input = (await search.boundingBox())!, mapBox = (await map.boundingBox())!;
    return { x: Math.round(input.x - mapBox.x), y: Math.round(input.y - mapBox.y) };
  }).toEqual({ x: inset, y: inset });
  await expect(map.getByRole("link", { name: "OpenStreetMap" })).toBeVisible();
  await expect(wrap.getByLabel("Map legend")).toHaveCount(0);
  await wrap.screenshot({ path: testInfo.outputPath("map-search.png") });
  checkDashboard();
});
