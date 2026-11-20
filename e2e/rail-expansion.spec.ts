import { expect, test, type Page } from "@playwright/test";
import { brtSunway, expandedRailServices } from "../lib/expanded-services";
import { railNetwork } from "../lib/simulation/network";

const time = new Date("2026-11-20T04:00:00Z");
const map = (page: Page) => page.getByLabel("Interactive transport map");
const filters = (page: Page) => page.getByRole("region", { name: "Dashboard filters" });
const chip = (page: Page, type: string) => filters(page).getByRole("button", { name: type, exact: true });
const search = (page: Page) => page.getByRole("textbox", { name: "Search vehicles, routes or stations" });
const popup = (page: Page) => page.locator(".rail-station-popup-shell");
const stations = railNetwork.stations.filter(record => record.stationProvenance?.length);
const busRoute = (page: Page) => filters(page).getByRole("combobox", { name: "Bus route" });

async function open(page: Page) {
  await page.clock.setFixedTime(time);
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (!process.env.TRANSITSCOPE_HOSTED_CHECK) {
    await page.route("**/api/bus-stops", route => route.fulfill({ json: { stops: [], unavailable: [] } }));
  }
  await page.goto("/");
  await expect(map(page).locator(".erl-klia-ekspres")).toHaveCount(1);
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 375, height: 844 }]) {
  test(`expanded routes, filters, and station navigation at ${viewport.width}px`, async ({ page, isMobile }, info) => {
    test.skip(isMobile === (viewport.width > 400));
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await open(page);
    for (const type of ["Bus", "MRT", "LRT", "Monorail", "KTM", "ERL", "Shared bike"]) {
      await expect(chip(page, type)).toHaveAttribute("aria-pressed", "true");
    }
    if (isMobile) await filters(page).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("01-overview.png") });

    const legend = page.getByLabel("Expanded route legend");
    const mapAndLegend = page.locator(".rail-map-group");
    for (const service of [...expandedRailServices, brtSunway]) {
      await expect(legend.getByText(service.name, { exact: true })).toBeVisible();
      const selector = service.mode === "Bus" ? ".brt-alignment" : `.${service.id}`;
      await expect(map(page).locator(selector)).toHaveAttribute("stroke", service.colour);
    }
    await expect(map(page).locator(".rail-alignment[stroke-dasharray]")).toHaveCount(0);
    await chip(page, "ERL").click();
    await expect(map(page).locator(".erl-klia-ekspres, .erl-klia-transit")).toHaveCount(0);
    await chip(page, "ERL").click();
    await legend.getByRole("button", { name: "Focus ERL KLIA Ekspres Line", exact: true }).click();
    await expect(map(page).locator(".leaflet-container")).toHaveAttribute("data-bus-zoom", /^(8|9|10)$/);
    await expect(map(page).locator(".erl-klia-transit")).not.toHaveAttribute("stroke-dasharray", /.+/);
    await mapAndLegend.screenshot({ path: info.outputPath("02-erl.png") });

    await chip(page, "LRT").click();
    await expect(map(page).locator(".lrt-shah-alam")).toHaveCount(0);
    await chip(page, "LRT").click();
    await legend.getByRole("button", { name: "Focus LRT Shah Alam Line" }).click();
    await mapAndLegend.screenshot({ path: info.outputPath("03-shah-alam.png") });

    const routes = busRoute(page);
    await routes.selectOption(brtSunway.id);
    await expect(map(page).locator(".bus-network-route, .bus-network-stop")).toHaveCount(0);
    await expect(map(page).locator(".brt-alignment")).toHaveCount(1);
    await expect(map(page).locator(".brt-station")).toHaveCount(5);
    await expect(map(page).locator(".brt-vehicle-icon")).toHaveCount(4);
    await mapAndLegend.screenshot({ path: info.outputPath("04-brt.png") });
    await chip(page, "Bus").click();
    await expect(map(page).locator(".brt-alignment, .brt-station, .brt-vehicle-icon")).toHaveCount(0);
    await chip(page, "Bus").click();
    await routes.selectOption("");
    await expect(map(page).locator(".bus-network-route")).toHaveCount(2);

    await search(page).fill("Glenmarie 2");
    await expect(popup(page).locator("strong")).toHaveText("Glenmarie");
    await expect(popup(page)).toContainText("LRT Kelana Jaya Line");
    await expect(popup(page)).toContainText("LRT Shah Alam Line");
    await expect(popup(page)).toContainText("SA7");
    await expect(popup(page)).toContainText("Interchange");
    await expect(popup(page)).toHaveCSS("opacity", "1");
    await map(page).screenshot({ path: info.outputPath("05-interchange.png") });
    await search(page).fill("");
    await expect(popup(page)).toHaveCount(0);

    await chip(page, "ERL").click();
    await search(page).fill("Salak Ting");
    await page.getByRole("option").filter({ hasText: "Salak Tinggi" }).click();
    await expect(popup(page)).toContainText("KT04");
    await expect(map(page).locator(".erl-klia-transit")).toHaveCount(0);
    await expect(map(page).locator(".rail-station")).toHaveCount(1);
    const bounds = await popup(page).boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    await page.getByRole("button", { name: "Reset dashboard", exact: true }).click();
    await expect(filters(page).locator('button[aria-pressed="true"]').filter({ hasNotText: "SIMULATED" })).toHaveCount(7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("every new station code opens its canonical popup and a BRT marker accepts map clicks", async ({ page, isMobile }) => {
  test.skip(isMobile);
  test.setTimeout(120_000);
  await open(page);
  for (const station of stations) {
    const code = station.stationProvenance![0].code;
    await test.step(code, async () => {
      await search(page).fill(code);
      await expect(popup(page).locator("strong")).toHaveText(station.name);
      await expect(popup(page)).toContainText(code);
      await search(page).fill("");
      await expect(popup(page)).toHaveCount(0);
    });
  }
  await busRoute(page).selectOption(brtSunway.id);
  await expect(map(page).locator(".brt-station")).toHaveCount(5);
  await map(page).scrollIntoViewIfNeeded();
  await map(page).locator(".brt-station").first().click({ timeout: 7000 });
  await expect(popup(page)).toContainText(brtSunway.name);
  await expect(popup(page)).toContainText(/BRT station · BRT[2-6]/);
});
