import { expect, test } from "@playwright/test";
import { simulationAlerts } from "../lib/simulation/scenarios";

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
  const colours = { High: "rgb(254, 226, 226)", Medium: "rgb(254, 243, 199)", Low: "rgb(219, 234, 254)" };
  for (const alert of alerts) await expect(toggle.getByText(`1 ${alert.severity}`)).toHaveCSS("background-color", colours[alert.severity]);
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
    await expect(row.getByText(alert.severity, { exact: true })).toHaveCSS("background-color", colours[alert.severity]);
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
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Reset dashboard" }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(mrt).toHaveAttribute("aria-pressed", "true");
  await expect(kpi).toHaveText("3");
  expect(alertRequests).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});
