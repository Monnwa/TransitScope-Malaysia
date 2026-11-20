import { expect, test, type Page } from "@playwright/test";

async function prepare(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-11-17T09:41:25Z"));
  await page.route("https://tile.openstreetmap.org/**", route => route.fulfill({ contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#eef1f2" d="M0 0h256v256H0z"/></svg>' }));
  await page.goto("/");
  await expect(page.locator(".rail-station")).not.toHaveCount(0);
}
const search = (page: Page) => page.getByRole("textbox", { name: "Search vehicles, routes or stations" });
const popup = (page: Page) => page.locator(".rail-station-popup-shell");
async function choose(page: Page, name: string) {
  await search(page).fill(name);
  await page.getByRole("row").filter({ has: page.getByRole("cell", { name, exact: true }) })
    .getByRole("button", { name: "View details" }).click();
  await expect(popup(page)).toHaveCount(1);
  await expect(popup(page)).toHaveCSS("opacity", "1");
  await expect(popup(page).locator("strong")).toHaveText(name);
  await expect(popup(page)).not.toHaveAttribute("data-rail-presentation-conflict", /.+/);
}

test("search selects merged TRX, opens native popup, repeats and replaces selection", async ({ page, isMobile }, info) => {
  await page.setViewportSize(isMobile ? { width: 375, height: 844 } : { width: 1101, height: 830 });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await prepare(page);
  await choose(page, "Tun Razak Exchange");
  const map = page.locator(".leaflet-container");
  await expect(map).toHaveAttribute("data-station-search-id", "rail:tun-razak-exchange:MRT1");
  await expect(map).toHaveAttribute("data-camera-zoom", "17");
  await expect(map.locator(".rail-station")).toHaveCount(1);
  await expect(popup(page)).toContainText("MRT Kajang Line (MRT1)");
  await expect(popup(page)).toContainText("MRT Putrajaya Line (MRT2)");
  await expect(popup(page)).toContainText("Interchange");
  const geometry = await popup(page).evaluate(element => {
    const p = element.getBoundingClientRect(), m = element.closest(".leaflet-container")!.getBoundingClientRect();
    const marker = element.closest(".leaflet-container")!.querySelector(".rail-station")!.getBoundingClientRect();
    const search = document.querySelector(".map-search")!.getBoundingClientRect();
    return { p: { left: p.left, right: p.right, top: p.top, bottom: p.bottom },
      m: { left: m.left, right: m.right, top: m.top, bottom: m.bottom },
      markerY: marker.top + marker.height / 2, searchBottom: search.bottom, viewportHeight: innerHeight };
  });
  expect(geometry.p.left).toBeGreaterThanOrEqual(geometry.m.left);
  expect(geometry.p.right).toBeLessThanOrEqual(geometry.m.right);
  expect(geometry.p.top).toBeGreaterThanOrEqual(Math.max(0, geometry.m.top));
  expect(geometry.p.bottom).toBeLessThanOrEqual(Math.min(geometry.viewportHeight, geometry.m.bottom));
  expect(geometry.markerY).toBeGreaterThan(geometry.searchBottom);
  await page.screenshot({ path: info.outputPath("trx-search-popup.png") });
  await popup(page).getByRole("button", { name: "Close popup" }).click();
  await expect(popup(page)).toHaveCount(0);
  await page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Tun Razak Exchange", exact: true }) })
    .getByRole("button", { name: "View details" }).click();
  await expect(popup(page)).toContainText("Tun Razak Exchange");
  await expect(map.locator(".rail-station")).toHaveCount(1);
  await expect(map.locator(".rail-alignment")).toHaveCount(8);
  await choose(page, "Taman Midah");
  await expect(popup(page)).not.toContainText("Tun Razak Exchange");
  await search(page).fill("");
  await popup(page).getByRole("button", { name: "Close popup" }).click();
  await expect(popup(page)).toHaveCount(0);
  await expect(map).not.toHaveAttribute("data-station-search-error", /.+/);
  expect(errors).toEqual([]);
});

test("bus, vehicle and route queries retain their existing selection behavior", async ({ page }) => {
  await prepare(page);
  await search(page).fill("MRT TAMAN MIDAH PINTU A");
  await page.getByRole("row").filter({ has: page.getByRole("cell", { name: "MRT TAMAN MIDAH PINTU A", exact: true }) })
    .getByRole("button", { name: "View details" }).first().click();
  await expect(page.getByRole("region", { name: "Upcoming Departures" })).toBeVisible();
  await expect(popup(page)).toHaveCount(0);
  await search(page).fill("Bus T401-01");
  await page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Bus T401-01", exact: true }) })
    .getByRole("button", { name: "View details" }).click();
  await expect(page.getByRole("region", { name: "Bus journey detail" })).toBeVisible();
  await expect(popup(page)).toHaveCount(0);
  await search(page).fill("T402");
  await expect(page.locator("#records tbody tr")).not.toHaveCount(0);
  await expect(popup(page)).toHaveCount(0);
  await search(page).fill("");
  await expect(popup(page)).toHaveCount(0);
});

test("successive station selections retain only the latest native popup", async ({ page }) => {
  await prepare(page);
  await choose(page, "Tun Razak Exchange");
  await choose(page, "Pasar Seni");
  await choose(page, "KL Sentral");
  await expect(popup(page)).toHaveCount(1);
  await expect(popup(page).locator("strong")).toHaveText("KL Sentral");
  await expect(page.locator(".leaflet-container")).toHaveAttribute("data-station-search-id", "rail:kl-sentral:LRT-KJ");
});
