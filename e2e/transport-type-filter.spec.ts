import { expect, test, type Page } from "@playwright/test";
import { simulationSnapshot } from "../lib/simulation";
import { railNetwork } from "../lib/simulation/network";
import type { Mode } from "../lib/transit-data";

const types: Mode[] = ["Bus", "MRT", "LRT", "Monorail", "KTM", "ERL", "Shared bike"];
const routeIds: Partial<Record<Mode, string[]>> = {
  MRT: ["MRT1", "MRT2"], LRT: ["LRT-KJ", "LRT-AG", "LRT-PH", "lrt-shah-alam"], Monorail: ["MONORAIL"],
  KTM: ["KTM:KA15_KD19", "KTM:KC05_KB18"],
  ERL: ["erl-klia-ekspres", "erl-klia-transit"],
};
const time = new Date("2026-11-14T04:00:00Z");
const snapshot = simulationSnapshot(time.getTime());
const map = (page: Page) => page.locator(".leaflet-container");
const search = (page: Page) => page.getByRole("textbox", { name: "Search vehicles, routes or stations" });
const option = (page: Page, name: string) => page.getByRole("listbox").getByRole("option").filter({
  has: page.getByText(name, { exact: true }),
});
const chip = (page: Page, type: Mode) => page.getByRole("region", { name: "Dashboard filters" })
  .getByRole("button", { name: type, exact: true });
const kpi = (page: Page, name: string) => page.locator(".kpi").filter({ has: page.getByText(name, { exact: true }) }).locator("strong");
const bikes = (page: Page) => map(page).locator(".linkbike-marker, .micromobility-marker");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(time);
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (!process.env.TRANSITSCOPE_HOSTED_CHECK) {
    await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, route => route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#eff2f0" d="M0 0h256v256H0z"/></svg>',
    }));
  }
});

async function setTypes(page: Page, enabled: Mode[], mobile: boolean) {
  for (const type of types) {
    const button = chip(page, type);
    const pressed = enabled.includes(type);
    if ((await button.getAttribute("aria-pressed")) !== String(pressed)) {
      if (mobile) await button.tap();
      else await button.click();
    }
    await expect(button).toHaveAttribute("aria-pressed", String(pressed));
    const active = /\bactive\b/;
    if (pressed) await expect(button).toHaveClass(active);
    else await expect(button).not.toHaveClass(active);
  }
}

async function expectLayers(page: Page, enabled: Mode[]) {
  const ids = enabled.flatMap(type => routeIds[type] ?? []);
  const busEnabled = enabled.includes("Bus");
  const bikeEnabled = enabled.includes("Shared bike");
  const lines = railNetwork.lines.filter(line => ids.includes(line.id));
  await expect(map(page).locator(".rail-alignment")).toHaveCount(lines.reduce((count, line) => count + line.paths.length, 0));
  for (const id of ids) {
    await expect(map(page).locator(".rail-alignment." + id.replace(/[^a-zA-Z0-9]/g, "-"))).not.toHaveCount(0);
  }
  const visibleLines = busEnabled ? [...ids, "brt-sunway"] : ids;
  await expect(map(page).locator(".rail-station, .brt-station")).toHaveCount(railNetwork.stations.filter(record =>
    record.railLines?.some(id => visibleLines.includes(id))).length);
  const trainCount = snapshot.trains.filter(train => ids.includes(train.lineId)).length;
  await expect(page.getByRole("region", { name: "Simulated train positions" }).getByRole("status"))
    .toContainText(new RegExp(`^${trainCount} simulated train`));
  if (trainCount) await expect(map(page).locator(".estimated-train-icon")).not.toHaveCount(0);
  else await expect(map(page).locator(".estimated-train-icon")).toHaveCount(0);
  await expect(map(page).locator(".bus-network-route")).toHaveCount(busEnabled ? 2 : 0);
  await expect(map(page).locator(".bus-vehicle-icon")).toHaveCount(busEnabled ? 8 : 0);
  const busStops = snapshot.records.filter(record => record.mode === "Bus" && !record.railLines && record.recordKind === "stop" && record.position);
  await expect(map(page).locator(".bus-network-stop")).toHaveCount(busEnabled ? busStops.length : 0);
  await expect(bikes(page)).toHaveCount(bikeEnabled ? 75 : 0);
  await expect(kpi(page, "Vehicles")).toHaveText(String(trainCount + (busEnabled ? 8 : 0)));
  await expect(kpi(page, "Routes")).toHaveText(String(ids.length + (busEnabled ? 3 : 0)));
  await expect(kpi(page, "Shared-bike stations")).toHaveText(bikeEnabled ? "27" : "0");
  const results = snapshot.records.filter(record => record.railLines ? record.railLines.some(id => visibleLines.includes(id))
    : record.mode === "Bus" ? busEnabled : record.mode === "Shared bike" && bikeEnabled).length;
  await expect(page.locator("#records tbody tr")).toHaveCount(results);
  await expect(page.locator("#map .panel-title p")).toContainText(`${results} result`);
}

test("transport chips filter map layers, summaries and lists, and reset restores defaults", async ({ page, isMobile }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  for (const type of types) await expect(chip(page, type)).toHaveAttribute("aria-pressed", "true");
  await expectLayers(page, types);
  await page.locator(".map-wrap").screenshot({ path: info.outputPath("01-all-selected.png") });

  const combinations: { enabled: Mode[]; screenshot?: string }[] = [
    { enabled: ["MRT"], screenshot: "02-mrt-only.png" },
    { enabled: ["LRT"] }, { enabled: ["Monorail"] }, { enabled: ["KTM"] }, { enabled: ["ERL"] }, { enabled: ["Bus"] },
    { enabled: ["Shared bike"], screenshot: "03-shared-bike-only.png" },
    { enabled: ["MRT", "Shared bike"] }, { enabled: ["Bus", "Shared bike"] }, { enabled: ["MRT", "LRT"] },
    { enabled: [], screenshot: "04-none-selected.png" },
  ];
  for (const { enabled, screenshot } of combinations) {
    await test.step(enabled.join(" + ") || "No types", async () => {
      await setTypes(page, enabled, isMobile);
      await expectLayers(page, enabled);
      if (screenshot) await page.locator(".map-wrap").screenshot({ path: info.outputPath(screenshot) });
    });
  }

  const busRoute = page.getByRole("combobox", { name: "Bus route" });
  await busRoute.selectOption("T401");
  await expect(map(page).locator(".bus-network-route, .bus-route-emphasis, .bus-network-stop")).toHaveCount(0);
  await setTypes(page, ["Bus", "MRT"], isMobile);
  await expect(map(page).locator(".bus-network-route")).toHaveCount(1);
  await expect(map(page).locator(".bus-network-route")).toHaveClass(/bus-route-T401/);
  await expect(map(page).locator(".bus-vehicle-icon")).toHaveCount(2);
  await expect(map(page).locator(".bus-network-stop")).toHaveCount(snapshot.records.filter(record =>
    record.routeId === "T401" && record.recordKind === "stop" && record.position).length);
  await expect(map(page).locator(".rail-alignment")).toHaveCount(2);
  await setTypes(page, ["MRT"], isMobile);
  await expect(busRoute).toHaveValue("T401");
  await expect(map(page).locator(".bus-network-route, .bus-route-emphasis, .bus-network-stop, .bus-vehicle-icon")).toHaveCount(0);

  await search(page).fill("Unknown station");
  await page.getByRole("button", { name: "Station available", exact: true }).click();
  await page.getByRole("button", { name: "Reset dashboard" }).click();
  await expect(search(page)).toHaveValue("");
  await expect(busRoute).toHaveValue("");
  await expect(page.getByRole("button", { name: "Station available", exact: true })).toHaveAttribute("aria-pressed", "false");
  for (const type of types) await expect(chip(page, type)).toHaveAttribute("aria-pressed", "true");
  await expectLayers(page, types);
  await page.locator(".map-wrap").screenshot({ path: info.outputPath("05-reset.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("station search retains hidden results and cannot reopen their map layers", async ({ page, isMobile }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(bikes(page)).toHaveCount(75);
  const location = "TRYKE · Millennium Monument surroundings";
  await search(page).fill(location);
  await expect(bikes(page)).toHaveCount(0);
  await option(page, location).click();
  const popup = page.getByRole("region", { name: "TRYKE location details" });
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("SIMULATED INVENTORY");
  await expect(popup).toContainText("SOURCE-BACKED LOCATION");
  await expect(popup.locator(".micromobility-inventory dt")).toHaveText(["Available bicycles", "Total docks"]);
  await expect(bikes(page)).toHaveCount(1);
  await setTypes(page, ["Bus", "MRT", "LRT", "Monorail", "KTM"], isMobile);
  await expect(popup).toHaveCount(0);
  await expect(bikes(page)).toHaveCount(0);
  await search(page).click();
  await expect(option(page, location)).toHaveAttribute("aria-disabled", "true");
  await search(page).press("Enter");
  await expect(option(page, location)).toContainText("Hidden by dashboard filters");
  await expect(popup).toHaveCount(0);
  await expect(bikes(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Clear station search" }).click();
  await expect(bikes(page)).toHaveCount(0);
  await setTypes(page, types, isMobile);
  await expect(map(page).locator(".linkbike-marker")).toHaveCount(27);
  for (const operator of ["HelloRide", "TRYKE", "Beam Mobility"]) {
    await expect(map(page).getByTitle(new RegExp(`^${operator} · `))).toHaveCount(16);
  }

  await setTypes(page, ["MRT", "LRT"], isMobile);
  await search(page).fill("Pasar Sen");
  await option(page, "Pasar Seni").click();
  await expect(map(page).locator(".rail-station-popup")).toContainText("Pasar Seni");
  await expect(map(page).locator(".rail-alignment.MRT1")).toHaveAttribute("stroke-opacity", "1");
  await expect(map(page).locator(".rail-alignment.LRT-KJ")).toHaveAttribute("stroke-opacity", "1");
  await expect(map(page).locator(".rail-alignment.MRT2")).toHaveAttribute("stroke-opacity", "0.18");
  await setTypes(page, ["MRT"], isMobile);
  await expect(map(page).locator(".rail-alignment")).toHaveCount(2);
  await expect(map(page).locator(".rail-station-popup")).toContainText("Pasar Seni");
  await expect(map(page).locator(".rail-alignment.MRT2")).toHaveAttribute("stroke-opacity", "0.18");
  await page.getByRole("button", { name: "Close popup", exact: true }).click();
  await expect(map(page).locator(".rail-alignment.MRT2")).toHaveAttribute("stroke-opacity", "1");
});
