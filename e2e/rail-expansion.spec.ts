import { expect, test, type Page } from "@playwright/test";
import { brtSunway } from "../lib/expanded-services";
import { railNetwork } from "../lib/simulation/network";

const time = new Date("2026-11-20T04:00:00Z");
const map = (page: Page) => page.getByLabel("Interactive transport map");
const filters = (page: Page) => page.getByRole("region", { name: "Dashboard filters" });
const chip = (page: Page, type: string) => filters(page).getByRole("button", { name: type, exact: true });
const search = (page: Page) => page.getByRole("textbox", { name: "Search vehicles, routes or stations" });
const popup = (page: Page) => page.locator(".rail-station-popup-shell");
const stations = railNetwork.stations.filter(record => record.stationProvenance?.length);
const busRoute = (page: Page) => filters(page).getByRole("combobox", { name: "Bus route" });
const indicatorNames = [
  "MRT Kajang Line", "MRT Putrajaya Line", "LRT Kelana Jaya Line", "LRT Ampang Line",
  "LRT Sri Petaling Line", "LRT Shah Alam Line", "KL Monorail Line",
  "KTM Tanjung Malim–Port Klang", "KTM Batu Caves–Pulau Sebang",
  "ERL KLIA Ekspres Line", "ERL KLIA Transit Line", "BRT Sunway Line",
];

async function open(page: Page) {
  await page.clock.setFixedTime(time);
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (!process.env.TRANSITSCOPE_HOSTED_CHECK) {
    await page.route("**/api/bus-stops", route => route.fulfill({ json: { stops: [], unavailable: [] } }));
  }
  await page.goto("/");
  await expect(map(page).locator(".erl-klia-ekspres")).toHaveCount(1);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 375, height: 844 }]) {
  test(`expanded routes, filters, and station navigation at ${viewport.width}px`, async ({ page, context, isMobile }, info) => {
    test.skip(isMobile === (viewport.width > 400));
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await open(page);
    await expect(page.getByLabel("Map legend", { exact: true })).toHaveCount(0);
    const indicators = page.getByRole("region", { name: "Map route indicators" });
    const nearby = page.getByRole("region", { name: "Nearby Public Transport" });
    const mapAndIndicators = page.locator(".rail-map-group");
    await expect(indicators.getByRole("listitem")).toHaveText(indicatorNames);
    expect(await indicators.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const indicatorBounds = (await indicators.boundingBox())!;
    const mapBounds = (await map(page).boundingBox())!;
    expect(indicatorBounds.y).toBeGreaterThanOrEqual(mapBounds.y + mapBounds.height);
    expect((await nearby.boundingBox())!.y).toBeGreaterThanOrEqual(indicatorBounds.y + indicatorBounds.height);
    await expect(map(page).locator(".leaflet-tile-loaded").first()).toBeAttached();
    await expect(map(page).locator(".bus-vehicle-icon")).toHaveCount(8);
    await expect.poll(() => map(page).locator(".bus-vehicle-icon").evaluateAll(markers => markers.map(marker => {
      const glyph = marker.querySelector("img");
      if (!glyph?.complete || !glyph.naturalWidth || glyph.getAttribute("src") !== "/markers/oncoming-bus.png") return false;
      const image = glyph.getBoundingClientRect();
      const pin = marker.getBoundingClientRect();
      return pin.width === 36 && pin.height === 36
        && Math.abs((image.left + image.width / 2) - (pin.left + pin.width / 2)) < 1
        && Math.abs((image.top + image.height / 2) - (pin.top + pin.height / 2)) < 1;
    }))).toEqual(Array(8).fill(true));
    await expect(map(page).locator(".estimated-train-icon span").first()).toContainText("🚆");
    await expect(map(page).locator(".bike-station-marker svg").first()).toHaveAttribute("viewBox", "0 0 24 24");
    for (const type of ["Bus", "MRT", "LRT", "Monorail", "KTM", "ERL", "Shared bike"]) {
      await expect(chip(page, type)).toHaveAttribute("aria-pressed", "true");
    }
    await page.locator("#map").screenshot({ path: info.outputPath(`default-map-${viewport.width}.png`) });

    for (const service of [...railNetwork.lines, brtSunway]) {
      const item = indicators.locator(`[data-route-id="${service.id}"]`);
      await expect(item).toHaveCount(1);
      const rgb = service.colour.slice(1).match(/../g)!.map(channel => parseInt(channel, 16));
      await expect(item.locator("i")).toHaveCSS("background-color", `rgb(${rgb.join(", ")})`);
      const selector = service.mode === "Bus" ? ".brt-alignment" : `.rail-alignment.${service.id.replace(/[^a-zA-Z0-9]/g, "-")}`;
      await expect(map(page).locator(selector)).toHaveAttribute("stroke", service.colour);
    }
    await expect(map(page).locator(".rail-alignment[stroke-dasharray]")).toHaveCount(0);
    await chip(page, "ERL").click();
    await expect(map(page).locator(".erl-klia-ekspres, .erl-klia-transit")).toHaveCount(0);
    await chip(page, "ERL").click();
    await indicators.getByRole("button", { name: "Focus ERL KLIA Ekspres Line", exact: true }).click();
    await expect(map(page).locator(".leaflet-container")).toHaveAttribute("data-bus-zoom", /^(8|9|10)$/);
    await expect(map(page).locator(".erl-klia-transit")).not.toHaveAttribute("stroke-dasharray", /.+/);
    await mapAndIndicators.screenshot({ path: info.outputPath(`rail-focus-${viewport.width}.png`) });

    await chip(page, "LRT").click();
    await expect(map(page).locator(".lrt-shah-alam")).toHaveCount(0);
    await chip(page, "LRT").click();
    await indicators.getByRole("button", { name: "Focus LRT Shah Alam Line" }).click();
    await mapAndIndicators.screenshot({ path: info.outputPath("03-shah-alam.png") });

    const routes = busRoute(page);
    await routes.selectOption(brtSunway.id);
    await expect(map(page).locator(".bus-network-route, .bus-network-stop")).toHaveCount(0);
    await expect(map(page).locator(".brt-alignment")).toHaveCount(1);
    await expect(map(page).locator(".brt-station")).toHaveCount(5);
    await expect(map(page).locator(".brt-vehicle-icon")).toHaveCount(4);
    await mapAndIndicators.screenshot({ path: info.outputPath("04-brt.png") });
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
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 3.142953, longitude: 101.719796 });
    await nearby.getByRole("button", { name: "Enable Location" }).click();
    await expect(nearby.getByRole("button", { name: /^View on Map:/ })).toHaveCount(5);
    await expect(map(page).locator(".user-icon span")).toHaveCSS("background-color", "rgb(22, 102, 216)");
    await page.locator("#map").screenshot({ path: info.outputPath(`nearby-transport-${viewport.width}.png`) });
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
