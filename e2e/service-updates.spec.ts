import { expect, test, type Page } from "@playwright/test";
import { simulationAlerts } from "../lib/simulation/scenarios";
import { railNetwork } from "../lib/simulation/network";
import { renderedStationPosition } from "./map-station";

test("Overview shows, filters and resets one accessible service alert list", async ({ page, isMobile }, info) => {
  const now = new Date("2026-11-20T06:00:00Z");
  const alerts = simulationAlerts(now.getTime());
  const runtimeErrors: string[] = [];
  const alertRequests: string[] = [];
  page.on("pageerror", error => runtimeErrors.push(error.message));
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/alerts") alertRequests.push(request.url());
  });
  await page.clock.setFixedTime(now);
  if (!process.env.TRANSITSCOPE_HOSTED_CHECK) {
    await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, route => route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#eff2f0" d="M0 0h256v256H0z"/></svg>',
    }));
  }
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);
  const overview = page.getByRole("region", { name: "Transport indicators" });
  const toggle = overview.getByRole("button", { name: "Service updates", exact: true });
  const panel = overview.getByRole("region", { name: "Service alerts", exact: true });
  const kpi = toggle.locator("strong");
  const setExpanded = () => isMobile ? toggle.tap() : toggle.click();
  const checkWidth = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAttribute("aria-controls", "alerts");
  await expect(panel).toHaveCount(0);
  await expect(kpi).toHaveText(String(alerts.length));
  await expect(toggle).toContainText("Simulated notices");
  const colours = { High: "rgb(220, 38, 38)", Medium: "rgb(151, 91, 0)", Low: "rgb(37, 99, 235)" };
  for (const alert of alerts) {
    const indicator = toggle.locator(".service-impact").filter({ hasText: `1 ${alert.severity}` });
    await expect(indicator).toBeVisible();
    await expect(indicator.locator("svg")).toHaveCSS("stroke", colours[alert.severity]);
    await expect(indicator.locator("svg")).toHaveAttribute("aria-hidden", "true");
  }
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await checkWidth();
  await page.screenshot({ path: info.outputPath("overview-collapsed.png"), animations: "disabled" });
  const collapsedHeight = (await overview.boundingBox())?.height;

  await setExpanded();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible();
  await expect(page.getByRole("heading", { name: "Service alerts", exact: true })).toHaveCount(1);
  await expect(panel.getByRole("heading", { level: 3 })).toHaveText(alerts.map(alert => alert.title));
  for (const alert of alerts) {
    const row = panel.getByRole("listitem").filter({ has: page.getByRole("heading", { name: alert.title, exact: true }) });
    await expect(page.getByRole("heading", { name: alert.title, exact: true })).toHaveCount(1);
    await expect(row.getByText(alert.severity, { exact: true })).toBeVisible();
    await expect(row.locator(".service-impact svg")).toHaveCSS("stroke", colours[alert.severity]);
    await expect(row).toContainText(alert.description);
    await expect(row).toContainText(alert.source);
    for (const route of alert.routes) await expect(row).toContainText(route);
    for (const station of alert.stations) await expect(row).toContainText(station);
    await expect(row.locator("time").first()).toHaveAttribute("datetime", alert.startedAt);
  }
  await checkWidth();
  await panel.screenshot({ path: info.outputPath("service-alerts-expanded.png"), animations: "disabled" });

  await page.getByRole("button", { name: "Refresh transport information" }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await setExpanded();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toHaveCount(0);
  expect((await overview.boundingBox())?.height).toBe(collapsedHeight);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toHaveCSS("animation-name", "none");
  await toggle.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("link", { name: "Service Alerts", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const alertFilter = panel.getByRole("combobox", { name: "Filter alerts" });
  await alertFilter.selectOption("Delay");
  await expect(kpi).toHaveText("1");
  await expect(panel.getByRole("heading", { level: 3 })).toHaveText(alerts[1].title);
  await panel.getByRole("button", { name: "Show affected station on map" }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("complementary", { name: "Selected transport detail" })).toContainText("Bukit Bintang");
  await expect(page.getByText(alerts[1].description, { exact: true })).toHaveCount(1);
  await toggle.press("Enter");
  await expect(page.getByRole("complementary", { name: "Selected transport detail" })).toContainText(alerts[1].description);
  await toggle.press("Enter");

  const filters = page.getByRole("region", { name: "Dashboard filters" });
  const mrt = filters.getByRole("button", { name: "MRT", exact: true });
  await mrt.click();
  await expect(panel.getByRole("listitem")).toHaveCount(0);
  await expect(kpi).toHaveText("0");
  await alertFilter.selectOption("All");
  await expect(kpi).toHaveText("2");
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  await filters.getByRole("button", { name: "KTM", exact: true }).click();
  await filters.getByRole("button", { name: "LRT", exact: true }).click();
  await expect(overview.getByText("No active service alerts")).toBeVisible();
  await expect(panel.getByRole("listitem")).toHaveCount(0);
  await expect(panel.getByRole("checkbox", { name: "Include notices outside transport filters" })).toBeVisible();
  await page.getByRole("button", { name: "Reset dashboard" }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(mrt).toHaveAttribute("aria-pressed", "true");
  await expect(kpi).toHaveText("3");
  expect(alertRequests).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});

const alertStations = (page: Page) => page.locator('.rail-station[stroke="#1666d8"][stroke-width="4"]');

test("alert navigation scrolls to the existing map, opens the station and restores filtered markers on close", async ({ page, isMobile }, info) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", error => runtimeErrors.push(error.message));
  await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, route => route.fulfill({
    contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#eff2f0" d="M0 0h256v256H0z"/></svg>',
  }));
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Service updates", exact: true });
  const panel = page.getByRole("region", { name: "Service alerts", exact: true });
  const map = page.locator(".leaflet-container");
  const popup = map.locator(".rail-station-popup-shell");
  const popupFits = () => popup.evaluate(element => {
    const bounds = element.getBoundingClientRect(), mapBox = element.closest(".leaflet-container")!.getBoundingClientRect();
    return bounds.left >= Math.max(0, mapBox.left) && bounds.right <= Math.min(innerWidth, mapBox.right) &&
      bounds.top >= Math.max(0, mapBox.top) && bounds.bottom <= Math.min(innerHeight, mapBox.bottom);
  });
  const searchIsClear = () => map.evaluate(element => {
    const search = element.querySelector(".map-search")!.getBoundingClientRect();
    const zoom = element.querySelector(".leaflet-control-zoom")!.getBoundingClientRect();
    return Math.min(search.right, zoom.right) <= Math.max(search.left, zoom.left) ||
      Math.min(search.bottom, zoom.bottom) <= Math.max(search.top, zoom.top);
  });
  const mrt = page.getByRole("region", { name: "Dashboard filters" }).getByRole("button", { name: "MRT", exact: true });
  await mrt.click();
  await toggle.click();
  await panel.getByRole("checkbox", { name: "Include notices outside transport filters" }).check();
  await expect(mrt).toHaveAttribute("aria-pressed", "false");

  const activate = (title: RegExp) => panel.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title }) })
    .getByRole("button", { name: "Show affected station on map" });
  const single = activate(/Bandar Tasik Selatan/);
  await single.scrollIntoViewIfNeeded();
  const start = await page.evaluate(() => scrollY);
  if (isMobile) await single.tap();
  else await single.click();
  const bts = railNetwork.stations.find(station => station.name === "Bandar Tasik Selatan")!;
  await expect(map).toHaveAttribute("data-station-search-id", bts.id);
  await expect(map).toHaveAttribute("data-camera-zoom", "17");
  await expect(popup).toContainText(bts.name);
  await expect(alertStations(page)).toHaveCount(1);
  const position = await renderedStationPosition(alertStations(page));
  expect(position.latitude).toBeCloseTo(bts.position![0], 4);
  expect(position.longitude).toBeCloseTo(bts.position![1], 4);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(start);
  await expect(popup.getByRole("button", { name: "Close popup" })).toBeFocused();
  await expect(popup).toHaveCSS("opacity", "1");
  await expect.poll(popupFits).toBe(true);
  await expect.poll(searchIsClear).toBe(true);
  await page.locator(".map-wrap").screenshot({ path: info.outputPath("alert-map.png"), animations: "disabled" });

  await page.emulateMedia({ reducedMotion: "reduce" });
  const multi = activate(/Longer waits/);
  await multi.press("Enter");
  const bukit = railNetwork.stations.find(station => station.name === "Bukit Bintang")!;
  await expect(map).toHaveAttribute("data-station-search-id", bukit.id);
  await expect(popup).toHaveCount(1);
  await expect(popup).toContainText(bukit.name);
  await expect(popup).toHaveCSS("opacity", "1");
  await expect.poll(popupFits).toBe(true);
  await expect.poll(searchIsClear).toBe(true);
  await expect(alertStations(page)).toHaveCount(2);
  await expect(map).toHaveCount(1);
  expect(Number(await map.getAttribute("data-camera-zoom"))).toBeLessThan(17);
  const markers = await alertStations(page).all();
  await expect.poll(async () => {
    const points = await Promise.allSettled(markers.map(renderedStationPosition));
    return ["Bukit Bintang", "Tun Razak Exchange"].map(name => {
      const [lat, lng] = railNetwork.stations.find(station => station.name === name)!.position!;
      return points.some(point => point.status === "fulfilled" &&
        Math.abs(point.value.latitude - lat) < .0002 && Math.abs(point.value.longitude - lng) < .0002);
    });
  }).toEqual([true, true]);
  await multi.press("Enter");
  await expect(popup).toHaveCount(1);
  await expect(popup.getByRole("button", { name: "Close popup" })).toBeFocused();
  await popup.getByRole("button", { name: "Close popup" }).click();
  await expect(popup).toHaveCount(0);
  await expect(alertStations(page)).toHaveCount(0);
  await expect(map.locator(".rail-alignment.MRT1")).toHaveCount(0);
  await expect(mrt).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(runtimeErrors).toEqual([]);
});
