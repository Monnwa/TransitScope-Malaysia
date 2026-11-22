import { expect, test, type Locator } from "@playwright/test";

const sections = ["Overview", "Service Alerts", "Map", "Nearby Public Transport", "About this information"];
const horizontalLogo = "/brand/transitscope-horizontal.svg";
const iconLogo = "/brand/transitscope-icon.svg";

async function expectLogo(logo: Locator, path: string) {
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", path);
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 375, height: 844 }]) {
  test(`branding and dashboard navigation at ${viewport.width} × ${viewport.height}`, async ({ page, isMobile }, info) => {
    test.skip(isMobile !== (viewport.width <= 720), "Run each viewport with its matching browser input mode.");
    await page.setViewportSize(viewport);
    await page.clock.setFixedTime(new Date("2026-11-14T04:00:00.000Z"));
    await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, route => route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf2f6"/></svg>',
    }));
    const brokenBrandRequests: string[] = [];
    page.on("requestfailed", request => {
      if (new URL(request.url()).pathname.startsWith("/brand/")) brokenBrandRequests.push(request.url());
    });
    page.on("response", response => {
      if (new URL(response.url()).pathname.startsWith("/brand/") && !response.ok() && response.status() !== 304)
        brokenBrandRequests.push(response.url());
    });
    await page.goto("/");
    const map = page.locator(".leaflet-container");
    await expect(map.locator(".rail-alignment")).toHaveCount(11);
    await expect(map.locator(".estimated-train-icon").first()).toBeAttached();

    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    const overview = page.getByRole("heading", { name: "Transport overview" });
    const header = page.locator("header");
    const menu = header.getByRole("button", { name: "Open navigation" });
    const home = page.getByRole("button", { name: "Back to Home", exact: true });
    const nearby = page.getByRole("region", { name: "Nearby Public Transport" });
    const screenshot = (name: string) => page.screenshot({
      path: info.outputPath(`${viewport.width}-${name}.png`), animations: "disabled", scale: "css",
    });
    const checkHome = async () => {
      await expect(home).toHaveCSS("position", "fixed");
      const box = (await home.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBe(box.width);
      expect(viewport.width - box.x - box.width).toBeCloseTo(isMobile ? 8 : 16, 0);
      expect(viewport.height - box.y - box.height).toBeCloseTo(isMobile ? 12 : 16, 0);
      await expect(home).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    };
    const openNavigation = async () => { if (isMobile) await menu.click(); };

    const favicon = page.locator('link[rel="icon"]');
    await expect(favicon).toHaveAttribute("href", iconLogo);
    for (const asset of [horizontalLogo, iconLogo]) {
      const response = await page.request.get(asset);
      expect(response.ok()).toBe(true);
      expect(response.headers()["content-type"]).toContain("image/svg+xml");
    }
    await expectLogo(header.getByRole("img", { name: "TransitScope Malaysia" }), horizontalLogo);
    await checkHome();
    await expect(overview).toBeInViewport();
    if (isMobile) {
      await screenshot("overview");
      await expect(nav).toBeHidden();
      const before = await overview.boundingBox();
      await menu.press("Enter");
      await expect(nav.getByRole("link", { name: "Overview" })).toBeFocused();
      expect(await overview.boundingBox()).toEqual(before);
      await page.keyboard.press("Escape");
      await expect(nav).toBeHidden();
      await expect(menu).toBeFocused();
    }

    await openNavigation();
    await expectLogo(nav.getByRole("img", { name: "TransitScope Malaysia" }), horizontalLogo);
    await expect(nav.getByRole("link")).toHaveText(sections);
    await expect(nav.getByRole("link", { name: "Routes & Stops" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "location");
    await screenshot(isMobile ? "drawer" : "expanded-sidebar");
    if (!isMobile) {
      await nav.getByRole("button", { name: "Collapse sidebar" }).click();
      await expectLogo(nav.getByRole("img", { name: "TransitScope Malaysia" }), iconLogo);
      await expect(nav.getByRole("link")).toHaveText(sections);
      await checkHome();
      await screenshot("collapsed-sidebar");
    }

    await nav.getByRole("link", { name: "Service Alerts" }).click();
    const alerts = page.getByRole("region", { name: "Service alerts", exact: true });
    await expect(alerts.getByRole("heading", { level: 3 }).first()).toBeVisible();
    await openNavigation();
    await expect(nav.getByRole("link", { name: "Service Alerts" })).toHaveAttribute("aria-current", "location");
    await nav.getByRole("link", { name: "Nearby Public Transport" }).click();
    await expect(page).toHaveURL(/#nearby-transit$/);
    await expect(nearby).toHaveCount(1);
    await expect(nearby.getByRole("heading")).toBeInViewport({ ratio: 1 });
    await expect(nearby.getByRole("button", { name: "Enable Location" })).toBeInViewport();
    await expect.poll(async () => Math.round((await nearby.boundingBox())!.y)).toBeGreaterThanOrEqual(isMobile ? 12 : 90);
    if (isMobile) await expect(nav).toBeHidden();
    else await expect(nav.getByRole("link", { name: "Nearby Public Transport" })).toHaveAttribute("aria-current", "location");
    await checkHome();
    await screenshot("nearby");

    const mrt = page.getByRole("button", { name: "MRT", exact: true });
    await mrt.click();
    await expect(mrt).toHaveAttribute("aria-pressed", "false");
    const search = page.getByRole("textbox", { name: "Search vehicles, routes or stations" });
    await search.fill("KL Sentr");
    await expect(page.getByRole("listbox", { name: "Station search results" }).getByRole("option").first()).toBeVisible();
    await search.press("Escape");
    const zoom = map.getByRole("button", { name: "Zoom in", exact: true });
    const attribution = map.getByRole("link", { name: "OpenStreetMap" });
    const beforeZoom = await map.getAttribute("data-camera-zoom");
    if (isMobile) await zoom.tap();
    else await zoom.click();
    await expect(map).not.toHaveAttribute("data-camera-zoom", beforeZoom!);
    await expect(map).not.toHaveClass(/leaflet-zoom-anim/);
    const homeLeft = (await home.boundingBox())!.x;
    for (const control of [zoom, attribution, page.getByRole("group", { name: "Map camera" })]) {
      const box = (await control.boundingBox())!;
      expect(box.x + box.width).toBeLessThan(homeLeft);
    }
    await checkHome();
    await screenshot("map-controls");
    const zoomAfterClick = await map.getAttribute("data-camera-zoom");

    if (isMobile) await home.tap();
    else await home.click();
    await expect(overview).toBeFocused();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect(mrt).toHaveAttribute("aria-pressed", "false");
    await expect(search).toHaveValue("KL Sentr");
    await expect(map).toHaveAttribute("data-camera-zoom", zoomAfterClick!);
    await expect(alerts).toBeAttached();
    await openNavigation();
    await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "location");
    expect(brokenBrandRequests).toEqual([]);
  });
}
