import { expect, test, type Page } from "@playwright/test";

const firstFix = { latitude: 3.142953, longitude: 101.719796, accuracy: 20 };
const nextFix = { latitude: 3.145, longitude: 101.723, accuracy: 160 };
const map = (page: Page) => page.locator(".leaflet-container");
const locate = (page: Page) => map(page).getByRole("button", { name: "Locate me", exact: true });
const status = (page: Page) => map(page).getByRole("status");
const nearby = (page: Page) => page.getByRole("region", { name: "Nearby Public Transport" });
const accuracyCircle = (page: Page) => map(page).locator(".user-location-accuracy");
const userMarker = (page: Page) => map(page).locator(".user-icon");

async function prepare(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    let requests = 0;
    Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
      value: (resolve: PositionCallback, reject: PositionErrorCallback) => {
        document.documentElement.dataset.locationRequests = String(++requests);
        window.addEventListener("mock-location", event => {
          const result = (event as CustomEvent<typeof firstFix | number>).detail;
          if (typeof result === "number") reject({ code: result } as GeolocationPositionError);
          else resolve({ coords: result } as GeolocationPosition);
        }, { once: true });
      },
    });
  });
  await page.route("**/api/bus-stops", route => route.fulfill({ json: { stops: [], unavailable: [] } }));
  await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, route => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf2f6"/></svg>',
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(locate(page)).toBeVisible();
}

async function reply(page: Page, result: typeof firstFix | number) {
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent("mock-location", { detail })), result);
}

async function expectCenter(page: Page, fix: typeof firstFix) {
  // Leaflet rounds projected positions to whole pixels when moving at the same zoom.
  await expect.poll(async () => Math.abs(Number(await map(page).getAttribute("data-camera-latitude")) - fix.latitude)).toBeLessThan(.00002);
  await expect.poll(async () => Math.abs(Number(await map(page).getAttribute("data-camera-longitude")) - fix.longitude)).toBeLessThan(.00002);
  await expect.poll(async () => Number(await map(page).getAttribute("data-camera-zoom"))).toBeGreaterThanOrEqual(16);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 375, height: 844 }]) {
  test(`locates and refreshes without disturbing map filters at ${viewport.width} × ${viewport.height}`, async ({ page, isMobile }) => {
    test.skip(isMobile !== (viewport.width < 720), "Run with the matching browser input mode.");
    await page.setViewportSize(viewport);
    await prepare(page);
    await expect(locate(page)).toHaveAccessibleName("Locate me");
    await expect(locate(page)).toHaveAttribute("title", "Locate Me");
    await expect(page.locator("html")).not.toHaveAttribute("data-location-requests", /.+/);

    const filters = page.getByRole("region", { name: "Dashboard filters" });
    await filters.getByRole("button", { name: "Bus", exact: true }).click();
    await filters.getByRole("button", { name: "MRT", exact: true }).click();
    await expect(map(page).locator(".rail-alignment.MRT1, .bus-route-T401")).toHaveCount(0);
    await locate(page).scrollIntoViewIfNeeded();
    const home = page.getByRole("button", { name: "Back to Home" });
    const box = (await locate(page).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    const controls = map(page).locator(".leaflet-control-zoom, .leaflet-control-attribution, .map-search input");
    for (const control of [...await controls.all(), home]) {
      const other = (await control.boundingBox())!;
      expect(box.x >= other.x + other.width || other.x >= box.x + box.width ||
        box.y >= other.y + other.height || other.y >= box.y + box.height).toBe(true);
    }

    await locate(page).click();
    await expect(page.locator("html")).toHaveAttribute("data-location-requests", "1");
    await expect(locate(page)).toBeDisabled();
    await expect(status(page)).toHaveText("Finding your location…");
    await reply(page, firstFix);
    await expectCenter(page, firstFix);
    await expect(userMarker(page)).toHaveCount(1);
    await expect(accuracyCircle(page)).toHaveCount(1);
    const circleWidth = (await accuracyCircle(page).boundingBox())!.width;
    const marker = await userMarker(page).elementHandle();
    const circle = await accuracyCircle(page).elementHandle();
    await expect(nearby(page).getByRole("button", { name: /^View on Map:/ }).first()).toBeVisible();

    await locate(page).click();
    await expect(page.locator("html")).toHaveAttribute("data-location-requests", "2");
    await expect(status(page)).toHaveText("Refreshing your location…");
    await reply(page, nextFix);
    await expectCenter(page, nextFix);
    await expect(status(page)).toContainText("Location accuracy is low");
    await expect(userMarker(page)).toHaveCount(1);
    await expect(accuracyCircle(page)).toHaveCount(1);
    expect(await marker!.evaluate(node => node.isConnected)).toBe(true);
    expect(await circle!.evaluate(node => node.isConnected)).toBe(true);
    expect((await accuracyCircle(page).boundingBox())!.width).toBeGreaterThan(circleWidth * 4);
    await expect(map(page).locator(".rail-alignment.MRT1, .bus-route-T401")).toHaveCount(0);

    await home.click();
    await expect(page.getByRole("heading", { name: "Transport overview" })).toBeInViewport();
  });
}

test("reuses a Nearby fix and keeps the selected station and fix after a timed-out refresh", async ({ page }) => {
  await prepare(page);
  await nearby(page).getByRole("button", { name: "Enable Location" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-location-requests", "1");
  await reply(page, firstFix);
  const station = nearby(page).getByRole("button", { name: "View on Map: Tun Razak Exchange" });
  await station.click();
  await expect(station).toHaveAttribute("aria-current", "true");
  await locate(page).click();
  await expectCenter(page, firstFix);
  await expect(page.locator("html")).toHaveAttribute("data-location-requests", "1");
  await expect(station).toHaveAttribute("aria-current", "true");

  await locate(page).click();
  await expect(page.locator("html")).toHaveAttribute("data-location-requests", "2");
  await reply(page, 3);
  await expect(status(page)).toContainText("took too long");
  await expect(status(page)).toContainText("last known location");
  await expectCenter(page, firstFix);
  await expect(userMarker(page)).toHaveCount(1);
  await expect(accuracyCircle(page)).toHaveCount(1);
  await expect(station).toHaveAttribute("aria-current", "true");
});

for (const [code, message] of [[1, "Location access was denied"], [2, "Your location is unavailable"]] as const) {
  test(`location error ${code} leaves the map usable`, async ({ page }) => {
    await prepare(page);
    await locate(page).click();
    await expect(status(page)).toContainText("Finding your location");
    await reply(page, code);
    await expect(status(page)).toContainText(message);
    await expect(userMarker(page)).toHaveCount(0);
    await expect(accuracyCircle(page)).toHaveCount(0);
    const search = page.getByRole("textbox", { name: "Search vehicles, routes or stations" });
    await search.fill("Tun Razak");
    await page.getByRole("option").filter({ hasText: "Tun Razak Exchange" }).filter({ hasText: "Rail station" }).first().click();
    await expect(map(page).locator(".rail-station-popup")).toContainText("Tun Razak Exchange");
  });
}

test("reports unsupported browser geolocation", async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => Object.defineProperty(navigator, "geolocation", { value: undefined }));
  await locate(page).click();
  await expect(status(page)).toContainText("This browser does not support location access");
  await expect(userMarker(page)).toHaveCount(0);
});
