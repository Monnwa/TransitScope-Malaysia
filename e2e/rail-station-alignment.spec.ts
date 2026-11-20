import { expect, test } from "@playwright/test";
import { renderedStationPosition } from "./map-station";

test("station search opens the marker at its published coordinates", async ({ page, isMobile }) => {
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/");
  const map = page.locator(".leaflet-container");
  const input = page.getByRole("textbox", { name: "Search vehicles, routes or stations" });
  const popup = map.locator(".rail-station-popup-shell");
  await input.fill("16 Sierra");
  await expect(popup.locator("strong")).toHaveText("16 Sierra");
  await expect(map).toHaveAttribute("data-station-search-id", "rail:16-sierra:MRT2");
  const position = await renderedStationPosition(map.locator(".rail-station"));
  expect(position.latitude).toBeCloseTo(2.964974, 4);
  expect(position.longitude).toBeCloseTo(101.654812, 4);
  await expect(map.locator(".rail-alignment.MRT2")).toHaveAttribute("stroke-opacity", "1");
  await expect(map.locator(".rail-alignment.MRT1")).toHaveAttribute("stroke-opacity", "0.18");
  await popup.getByRole("button", { name: "Close popup" }).click();
  await expect(popup).toHaveCount(0);
  await expect(map.locator(".rail-alignment.MRT1")).toHaveAttribute("stroke-opacity", "1");

  await input.fill("Salak Selatan");
  const results = page.getByRole("listbox", { name: "Station search results" });
  const stations = results.getByRole("option").filter({ hasText: "Rail station" });
  await expect(stations).toHaveCount(2);
  await expect(popup).toHaveCount(0);
  const ktm = stations.filter({ hasText: "KTM Batu Caves" });
  if (isMobile) await ktm.tap();
  else await ktm.click();
  await expect(popup.locator("strong")).toHaveText("Salak Selatan");
  await expect(map).toHaveAttribute("data-station-search-id", "rail:salak-selatan:KTM:KC05_KB18");
  await expect(map.locator(".rail-alignment.KTM-KC05-KB18")).toHaveAttribute("stroke-opacity", "1");
  await expect(map.locator(".rail-alignment.LRT-PH")).toHaveAttribute("stroke-opacity", "0.18");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(pageErrors).toEqual([]);
});
