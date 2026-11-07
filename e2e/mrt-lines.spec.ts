import { expect, test } from "@playwright/test";
const line = (id: string, name: string, colour: string) => ({ id, name, colour, mode: "MRT", geometryStatus: "available", paths: [[[3.14, 101.70], [3.142403, 101.720156]]], dataMode: "STATIC", source: "Synthetic interaction fixture" });
const lines = [line("MRT1", "MRT Kajang Line (MRT1)", "#006B3F"), line("MRT2", "MRT Putrajaya Line (MRT2)", "#F2C500")];
const station = { id: "trx", name: "TRX", mode: "MRT", operator: "Test", railLines: ["MRT1", "MRT2"], lineNames: lines.map(line => line.name), mrtLines: ["MRT1", "MRT2"], route: lines.map(line => line.name).join(" · "), station: "TRX", position: [3.142403, 101.720156], dataMode: "STATIC", status: "Station available", source: "Synthetic interaction fixture", recordKind: "stop", reportedAt: null, interchange: true };
test("station-first loading survives vehicle refresh; line switches and shared station selection work", async ({ page }) => {
  let liveRequests = 0, completedLiveRequests = 0;
  await page.clock.install();
  await page.route("**/api/transit?*", async route => {
    if (!route.request().url().includes("includeStatic")) { liveRequests++; await new Promise(resolve => setTimeout(resolve, 700)); }
    await route.fulfill({ json: { records: [], alerts: [], feeds: [], fetchedAt: new Date().toISOString(), demo: false } });
    if (!route.request().url().includes("includeStatic")) completedLiveRequests++;
  });
  await page.route("**/api/rail-network?*", route => route.fulfill({ json: { available: true, lines: route.request().url().includes("ktmb") ? [] : lines, stations: route.request().url().includes("ktmb") ? [] : [station], source: "Test" } }));
  await page.goto("/");
  await expect(page.locator('.rail-station')).toHaveCount(1);
  const kajang = page.getByRole("button", { name: "MRT Kajang Line (MRT1)", exact: true });
  const putrajaya = page.getByRole("button", { name: "MRT Putrajaya Line (MRT2)", exact: true });
  await kajang.click(); await expect(page.locator(".rail-alignment.MRT2")).toHaveAttribute("stroke-opacity", "0.3");
  await page.locator(".rail-alignment.MRT2").click({ force: true }); await expect(putrajaya).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Show MRT Kajang Line (MRT1)").uncheck(); await expect(page.locator(".rail-alignment.MRT1")).toHaveCount(0);
  await page.getByLabel("Show MRT Putrajaya Line (MRT2)").uncheck(); await expect(page.locator('.rail-station')).toHaveCount(0);
  await page.getByLabel("Show MRT Kajang Line (MRT1)").check();
  await expect(page.locator('.leaflet-pan-anim')).toHaveCount(0);
  await page.locator('.rail-station').click();
  await expect(page.getByLabel("Selected transport detail")).toContainText("TRX");
  await expect(page.getByLabel("Show MRT Putrajaya Line (MRT2)")).toBeChecked();
  await expect(page.getByLabel("Selected transport detail")).toContainText("MRT Putrajaya Line (MRT2)");
  await page.clock.fastForward(31000);
  await expect.poll(() => liveRequests).toBeGreaterThan(1);
  await expect.poll(() => completedLiveRequests).toBeGreaterThan(1);
  await expect(page.getByRole("status").filter({ hasText: "Refreshing official transport sources" })).toHaveCount(0);
  await expect(page.locator('.rail-station')).toHaveCount(1);
  await page.getByRole("button", { name: "Refresh transport information" }).click();
  await expect(page.locator('.rail-station')).toHaveCount(1);
});
test("missing KTM geometry preserves distinct service stations and controls", async ({ page }) => {
  await page.route("**/api/transit?*", route => route.fulfill({ json: { records: [], alerts: [], feeds: [], fetchedAt: new Date().toISOString(), demo: false } }));
  await page.route("**/api/rail-network?*", route => route.fulfill({ json: route.request().url().includes("rapid-rail-kl") ? {available:true,lines:[],stations:[],source:"Test"} : { available: true, lines: [{ ...line("KTM:A", "KTM Seremban Line", "#24558A"), paths: [], geometryStatus: "unavailable", mode: "KTM" }, { ...line("KTM:B", "KTM Port Klang Line", "#24558A"), paths: [], geometryStatus: "unavailable", mode: "KTM" }], stations: [{ ...station, id: "kl", name: "Kuala Lumpur", mode: "KTM", railLines: ["KTM:A", "KTM:B"], lineNames: ["KTM Seremban Line", "KTM Port Klang Line"] }], source: "Test" } }));
  await page.goto("/"); await expect(page.locator('.rail-station')).toHaveCount(1);
  await expect(page.getByLabel("Show KTM Seremban Line")).toBeChecked(); await expect(page.getByLabel("Show KTM Port Klang Line")).toBeChecked();
  await expect(page.getByText("Route map unavailable")).toHaveCount(2);
});
