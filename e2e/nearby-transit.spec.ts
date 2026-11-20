import { expect, test, type Page } from "@playwright/test";
import type { SearchBusStop } from "../lib/bus-stop-search";

const origin = { latitude: 3.142953, longitude: 101.719796, accuracy: 20 };
const feeder: SearchBusStop = {
  id: "bus-stop:rapid-bus-mrtfeeder:nearby-test", sourceId: "nearby-test", name: "Test Feeder Stop",
  position: [origin.latitude + 0.00025, origin.longitude], operator: "Prasarana", feed: "MRT Feeder Bus",
  aliases: [], routes: [{ id: "T401", name: "T401" }],
};
const panel = (page: Page) => page.getByRole("region", { name: "Nearby Public Transport" });
const map = (page: Page) => page.locator(".leaflet-container");
const recommendations = (page: Page) => panel(page).getByRole("button", { name: /^View on Map:/ });

async function prepare(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/bus-stops", route => route.fulfill({ json: { stops: [feeder], unavailable: [] } }));
  await page.goto("/");
  await expect(map(page)).toBeVisible();
}

async function expectLayout(page: Page) {
  const mapBox = (await map(page).boundingBox())!;
  const panelBox = (await panel(page).boundingBox())!;
  expect(panelBox.y).toBeGreaterThanOrEqual(mapBox.y + mapBox.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await panel(page).evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(panelBox.width);
}

test("location is opt-in and the panel announces a pending request", async ({ page, isMobile }, info) => {
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.locationRequests = "0"; });
    Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
      value: () => { document.documentElement.dataset.locationRequests = "1"; },
    });
  });
  await prepare(page);
  await expect(page.locator("html")).toHaveAttribute("data-location-requests", "0");
  await expect(map(page).locator(".user-icon")).toHaveCount(0);
  await expectLayout(page);
  await panel(page).screenshot({ path: info.outputPath("01-enable-location.png") });
  await panel(page).getByRole("button", { name: "Enable Location" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-location-requests", "1");
  await expect(panel(page).getByRole("status")).toContainText("Finding your location");
  await panel(page).screenshot({ path: info.outputPath("02-location-loading.png") });
});

for (const width of [390, 375]) {
  test(`renders recommendations and map navigation at ${width}px mobile or desktop`, async ({ page, context, isMobile }, info) => {
    test.skip(!isMobile && width === 375, "Desktop coverage runs once.");
    await page.setViewportSize(isMobile ? { width, height: 844 } : { width: 1440, height: 1000 });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(origin);
    await prepare(page);
    const dashboardFilters = page.getByRole("region", { name: "Dashboard filters" });
    await dashboardFilters.getByRole("button", { name: "MRT", exact: true }).click();
    await dashboardFilters.getByRole("button", { name: "Bus", exact: true }).click();
    await expect(map(page).locator(".rail-alignment.MRT1, .bus-route-T401")).toHaveCount(0);
    await panel(page).getByRole("button", { name: "Enable Location" }).click();
    await expect(panel(page).getByRole("status")).toContainText("Location available");
    await expect(map(page).locator(".user-icon")).toHaveCount(1);
    await expect(recommendations(page)).toHaveCount(5);
    await expectLayout(page);
    if (!isMobile) await page.locator("#map > .panel").first().screenshot({ path: info.outputPath("03-location-detected.png") });
    await panel(page).screenshot({ path: info.outputPath(isMobile ? `07-mobile-${width}.png` : "04-five-recommendations.png") });

    await panel(page).getByRole("button", { name: "Show More" }).click();
    await expect.poll(() => recommendations(page).count()).toBeGreaterThan(5);
    await expectLayout(page);
    if (!isMobile) await panel(page).screenshot({ path: info.outputPath("05-expanded-recommendations.png") });
    await panel(page).getByRole("button", { name: "Show Less" }).click();
    await expect(recommendations(page)).toHaveCount(5);

    const trx = panel(page).getByRole("button", { name: "View on Map: Tun Razak Exchange" });
    await trx.click();
    await expect(map(page).locator(".rail-station-popup")).toContainText("Tun Razak Exchange");
    await expect(trx).toHaveAttribute("aria-current", "true");
    await expect(map(page).locator(".rail-station[stroke='#1666d8'][stroke-width='4']")).toHaveCount(1);
    await expect(map(page).locator(".rail-alignment.MRT1")).toHaveCount(1);
    await expect(map(page).locator(".user-icon")).toHaveCount(1);
    if (!isMobile) {
      await expect(map(page).locator(".rail-station-popup-shell")).toHaveCSS("opacity", "1");
      await page.locator("#map > .panel").first().screenshot({ path: info.outputPath("06-selected-station.png") });
    }

    await panel(page).getByRole("button", { name: "View on Map: Test Feeder Stop" }).click();
    await expect(map(page).locator(".bus-search-popup")).toContainText("Test Feeder Stop");
    await expect(map(page).locator(".rail-station-popup")).toHaveCount(0);
    await expect(map(page).locator(".bus-search-stop")).toHaveAttribute("stroke", "#1666d8");
    await expect(map(page).locator(".bus-route-T401")).toHaveCount(1);
    await panel(page).getByRole("button", { name: "Clear selection" }).click();
    await expect(map(page).locator(".bus-search-popup, .bus-search-stop, .rail-alignment.MRT1, .bus-route-T401")).toHaveCount(0);
    await expect(map(page).locator(".user-icon")).toHaveCount(1);
    await expect(panel(page).getByRole("button", { name: "Clear selection" })).toHaveCount(0);

    await context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 10 });
    await panel(page).getByRole("button", { name: "Refresh Location" }).click();
    await expect(panel(page).getByText("No public transport locations found within 3 km.")).toBeVisible();
    await expect(map(page).locator(".user-icon")).toHaveCount(1);
  });
}

test("denied location leaves ordinary station search and popups available", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
      value: (_resolve: PositionCallback, reject: PositionErrorCallback) => reject({ code: 1 } as GeolocationPositionError),
    });
  });
  await prepare(page);
  await panel(page).getByRole("button", { name: "Enable Location" }).click();
  await expect(panel(page).getByRole("status")).toContainText("Location access was denied");
  await expect(panel(page).getByRole("button", { name: "Retry Location" })).toBeVisible();
  await expect(map(page).locator(".user-icon")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search vehicles, routes or stations" }).fill("Tun Razak");
  await page.getByRole("option").filter({ hasText: "Tun Razak Exchange" }).filter({ hasText: "Rail station" }).first().click();
  const popup = map(page).locator(".rail-station-popup");
  await expect(popup).toContainText("Tun Razak Exchange");
  await map(page).getByRole("button", { name: "Close popup" }).click();
  await expect(popup).toHaveCount(0);
  await expectLayout(page);
});
