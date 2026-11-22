import { selectVehicle } from "./map-station";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { join } from "node:path";
import { setMapZoom } from "./map-zoom";

const time = Date.parse("2026-11-14T04:00:00Z");
const unit = "UNIT BERKUDA DBKL (UTARA)";
const short = "LRT SALAK SELATAN";
const long = "HOSPITAL REHABILITASI CHERAS (JPR)";
const tolerance = 0.5;

async function openMap(page: Page, mobile: boolean) {
  await page.setViewportSize(mobile ? { width: 375, height: 844 } : { width: 1265, height: 720 });
  if (!process.env.SM23G_REAL_TILES) {
    await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, route => route.fulfill({
      contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>',
    }));
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date(time));
  await page.goto("/");
  const map = page.locator(".leaflet-container");
  await expect(map.locator(".bus-vehicle-icon")).toHaveCount(8);
  await expect(map.locator(".bus-journey-stop")).toHaveCount(0);
  await map.scrollIntoViewIfNeeded();
  await setMapZoom(map, 12);
  await expect(map.locator(".leaflet-tile-loaded[src*='/12/']").first()).toBeAttached();
  await expect(map).not.toHaveClass(/leaflet-zoom-anim/);
  return map;
}

async function selectT402(page: Page, mobile: boolean) {
  const detail = page.getByRole("region", { name: "Bus journey detail" });
  await selectVehicle(page, "Bus T402-01");
  await expect(detail.getByRole("heading", { name: /Bus T402-01/ })).toBeVisible();
  if (mobile) await detail.getByRole("button", { name: "Collapse journey" }).tap();
  return detail;
}

async function relativeCentre(map: Locator, pin: Locator) {
  const [m, p] = await Promise.all([map.boundingBox(), pin.boundingBox()]);
  if (!m || !p) throw new Error("Map and stop must be mounted");
  return { x: p.x + p.width / 2 - m.x, y: p.y + p.height / 2 - m.y, width: m.width, height: m.height };
}

// Pan with real map input and measure the stop relative to the map after each drag.
async function putStopAt(page: Page, map: Locator, pin: Locator, x: number, y: number) {
  await map.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 6; attempt++) {
    const start = await relativeCentre(map, pin);
    const dx = Math.trunc(Math.max(-100, Math.min(100, x - start.x)));
    const dy = Math.trunc(Math.max(-100, Math.min(100, y - start.y)));
    if (Math.abs(x - start.x) <= 2 && Math.abs(y - start.y) <= 2) return;
    const box = (await map.boundingBox())!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx, from.y + dy);
    await page.mouse.up();
    await expect.poll(async () => {
      const next = await relativeCentre(map, pin);
      return Math.abs(next.x - start.x) + Math.abs(next.y - start.y);
    }).toBeGreaterThan(0);
  }
  throw new Error("Could not pan the stop to the requested boundary");
}

async function bounds(popup: Locator) {
  return popup.evaluate(element => {
    const map = element.closest(".leaflet-container")!;
    const button = element.querySelector(".leaflet-popup-close-button")!;
    const rect = (element: Element) => {
      const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const m = rect(map), p = rect(element), c = rect(button);
    const overflow = (outer: typeof m, inner: typeof m) => Math.max(
      0, outer.left - inner.left, inner.right - outer.right, outer.top - inner.top, inner.bottom - outer.bottom,
    );
    const hit = (x: number, y: number) => button.contains(document.elementFromPoint(x, y));
    return {
      map: m, popup: p, close: c, overflow: overflow(m, p), closeOverflow: overflow(p, c),
      hits: [hit(c.left + 1, c.top + 1), hit(c.right - 1, c.top + 1),
        hit(c.left + 1, c.bottom - 1), hit(c.right - 1, c.bottom - 1), hit(c.left + c.width / 2, c.top + c.height / 2)],
      view: { width: document.documentElement.clientWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth },
    };
  });
}

async function checkPopup(popup: Locator, testInfo: TestInfo, label: string, page: Page, before?: Awaited<ReturnType<typeof relativeCentre>>) {
  await expect(popup).toBeVisible();
  try {
    await expect.poll(async () => {
      const sample = await bounds(popup);
      return Math.max(sample.overflow, sample.closeOverflow);
    }).toBeLessThanOrEqual(tolerance);
    const sample = await bounds(popup);
    expect(sample.hits).toEqual([true, true, true, true, true]);
    expect(sample.view.documentWidth).toBe(sample.view.width);
    expect(sample.view).toMatchObject(testInfo.project.name === "mobile-chromium"
      ? { width: 375, height: 844 } : { width: 1265, height: 720 });
  } finally {
    const sample = await bounds(popup);
    console.log(JSON.stringify({ label, before, ...sample }));
    await testInfo.attach(label + "-bounds", { body: JSON.stringify({ before, ...sample }, null, 2), contentType: "application/json" });
    if (process.env.SM23G_SCREENSHOTS) {
      await page.screenshot({ path: join(process.env.SM23G_SCREENSHOTS, label + ".png"), animations: "disabled" });
    }
  }
}

async function assertT402(map: Locator) {
  await expect(map.locator(".vehicle-selected")).toHaveAttribute("title", "Bus T402-01");
  await expect(map.locator(".bus-journey-stop")).toHaveCount(17);
  await expect(map.locator(".gps-route-completed, .gps-route-remaining")).toHaveCount(2);
}

test.describe("stop popup at mobile map boundaries", () => {
  test.skip(({ isMobile }) => !isMobile);

  test("keeps the exact UNIT BERKUDA stop popup and close control usable", async ({ page }, info) => {
    const map = await openMap(page, true);
    await selectT402(page, true);
    const pin = map.getByRole("button", { name: unit, exact: true });
    await putStopAt(page, map, pin, 197, 160);
    const before = await relativeCentre(map, pin);
    expect(before.x).toBeGreaterThan(194);
    // Leaflet exposes focusable pins even when a vehicle shares their screen position.
    await pin.press("Enter");
    await page.clock.setFixedTime(new Date(time + 1000));
    const popup = map.locator(".leaflet-popup").filter({ has: page.locator(".journey-stop-popup") });
    await expect(popup).toContainText(unit);
    await checkPopup(popup, info, "mobile-unit-berkuda", page, before);
    await popup.getByRole("button", { name: "Close popup" }).tap();
    await expect(popup).toHaveCount(0);
    await assertT402(map);

    const next = map.getByRole("button", { name: long, exact: true });
    await putStopAt(page, map, next, 150, 165);
    await next.press("Enter");
    await page.clock.setFixedTime(new Date(time + 2000));
    await expect(popup).toContainText(long);
    await expect(popup).not.toContainText(unit);
    await checkPopup(popup, info, "mobile-second-stop", page);
    await popup.getByRole("button", { name: "Close popup" }).tap();
    await expect(popup).toHaveCount(0);
    await assertT402(map);
  });

  for (const edge of [
    { side: "right", name: long, x: (w: number) => w - 24, y: () => 170 },
    { side: "left", name: short, x: () => 24, y: () => 170 },
    { side: "top", name: long, x: () => 160, y: () => 24 },
    { side: "bottom", name: short, x: () => 160, y: (h: number) => h - 24 },
  ]) {
    test(`fits a stop popup at the ${edge.side} edge`, async ({ page }, info) => {
      const map = await openMap(page, true);
      await selectT402(page, true);
      const pin = map.getByRole("button", { name: edge.name, exact: true });
      const mapBox = (await map.boundingBox())!;
      const target = { x: edge.x(mapBox.width), y: edge.y(mapBox.height) };
      await putStopAt(page, map, pin, target.x, target.y);
      const before = await relativeCentre(map, pin);
      expect(Math.abs(before.x - target.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(before.y - target.y)).toBeLessThanOrEqual(2);
      // Leaflet also supports keyboard activation for the bottom pin.
      await pin.press("Enter");
      await page.clock.setFixedTime(new Date(time + 1000));
      const popup = map.locator(".leaflet-popup").filter({ has: page.locator(".journey-stop-popup") });
      await expect(popup).toContainText(edge.name);
      await checkPopup(popup, info, `mobile-${edge.side}`, page, before);
      await popup.getByRole("button", { name: "Close popup" }).tap();
      await expect(popup).toHaveCount(0);
      await assertT402(map);
    });
  }
});

test("keeps desktop vehicle and timeline popups fully inside the map", async ({ page, isMobile }, info) => {
  test.skip(isMobile);
  const map = await openMap(page, false);
  await map.getByRole("button", { name: "Bus T401-01", exact: true }).click();
  await page.clock.setFixedTime(new Date(time + 1000));
  const vehicle = map.locator(".leaflet-popup").filter({ has: page.locator(".bus-vehicle-popup") });
  await expect(vehicle).toContainText("Bus T401-01");
  await checkPopup(vehicle, info, "desktop-vehicle", page);
  await vehicle.getByRole("button", { name: "Close popup" }).click();
  await expect(vehicle).toHaveCount(0);

  const detail = page.getByRole("region", { name: "Bus journey detail" });
  await detail.locator(".bus-stop-control").first().click();
  await page.clock.setFixedTime(new Date(time + 2000));
  const stop = map.locator(".leaflet-popup").filter({ has: page.locator(".journey-stop-popup") });
  await expect(stop).toContainText("T401 · SIMULATED");
  await expect(map).toHaveAttribute("data-focused-zoom", "17");
  await checkPopup(stop, info, "desktop-timeline", page);
  await stop.getByRole("button", { name: "Close popup" }).click();
  await expect(stop).toHaveCount(0);
  await expect(map.locator(".vehicle-selected")).toHaveAttribute("title", "Bus T401-01");
});
