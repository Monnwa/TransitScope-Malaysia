import { expect, test } from "@playwright/test";
import { brtSunway } from "../lib/expanded-services";
import { simulationSnapshot } from "../lib/simulation";
import { busRoutes, railNetwork } from "../lib/simulation/network";
import type { SearchBusStop } from "../lib/bus-stop-search";
import { chooseSearchStation } from "./map-station";

const time = new Date("2026-11-20T04:00:00Z");
const penangStop: SearchBusStop = {
  id: "bus-stop:rapid-bus-penang:test-1", sourceId: "test-1", name: "Penang GTFS test stop",
  position: [5.411, 100.337], operator: "Prasarana", feed: "Rapid Penang", aliases: [],
  routes: [{ id: "fixture-301", name: "301" }],
};
const duplicate = { ...penangStop, routes: [{ id: "fixture-302", name: "302" }] };
const unknown = { ...penangStop, id: "bus-stop:unknown:test-1", name: "Unknown feed test stop" };
const klStop = { ...penangStop, id: "bus-stop:rapid-bus-kl:test-1", name: "Klang Valley GTFS test stop",
  position: [3.142, 101.699] as [number, number], feed: "Rapid KL Bus", routes: [{ id: "fixture-kl", name: "KL fixture" }] };

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 375, height: 844 }]) {
  test(`regional overview and map at ${viewport.width}px`, async ({ page, isMobile, context }) => {
    test.skip(isMobile !== (viewport.width < 400));
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.setFixedTime(time);
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 5.411, longitude: 100.337 });
    await page.route("**/api/bus-stops", route => route.fulfill({ json: {
      stops: [penangStop, duplicate, klStop, unknown], unavailable: [],
    } }));
    await page.goto("/");
    const selector = page.getByRole("combobox", { name: "Region" });
    const vehicles = page.getByRole("article", { name: "Vehicles", exact: true });
    const routes = page.getByRole("article", { name: "Routes", exact: true });
    const map = page.locator(".leaflet-container");
    const nearby = page.getByRole("region", { name: "Nearby Public Transport" });
    const snapshot = simulationSnapshot(time.getTime());
    await expect(page.getByRole("heading", { name: "Transport overview", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Malaysia transport overview" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Transport by mode" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Vehicles, routes and stops" })).toHaveCount(0);
    await expect(selector.locator("option")).toHaveText(["Klang Valley", "Penang"]);
    await expect(selector).toHaveValue("Klang Valley");
    await expect(selector).toBeVisible();
    await expect(vehicles.locator("strong")).toHaveText(String(snapshot.records.filter(record => record.recordKind === "vehicle").length));
    for (const mode of ["MRT", "LRT", "Monorail", "KTM", "ERL"]) {
      const row = vehicles.getByRole("listitem").filter({ hasText: `${mode} train` });
      await expect(row.locator("[data-icon]")).toHaveAttribute("data-icon", "train");
      await expect(row.locator("b")).toHaveText(String(snapshot.trains.filter(train => train.mode === mode).length));
    }
    for (const [name, count] of [["Bus", 4], ["BRT bus", 4]] as const) {
      const row = vehicles.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
      await expect(row.locator("[data-icon]")).toHaveAttribute("data-icon", "bus");
      await expect(row.locator("b")).toHaveText(String(count));
    }
    await expect(page.getByRole("article", { name: "Shared-bike stations" }).locator("[data-icon]")).toHaveAttribute("data-icon", "bike");
    await expect(routes.getByRole("heading", { level: 3 })).toHaveText(["MRT", "LRT", "Monorail", "KTM Komuter", "ERL", "Bus", "BRT"]);
    const canonicalRoutes = [...railNetwork.lines, ...busRoutes];
    await expect(routes.locator("[data-route-id]")).toHaveCount(canonicalRoutes.length);
    for (const route of canonicalRoutes) {
      const entry = routes.locator(`[data-route-id="${route.id}"]`);
      await expect(entry).toHaveCount(1);
      await expect(entry).toHaveText(route.name);
      await expect(entry.locator("i")).toHaveCSS("background-color", `rgb(${route.colour.slice(1).match(/../g)!.map(part => parseInt(part, 16)).join(", ")})`);
    }
    await expect(routes.getByRole("heading", { name: "BRT", exact: true }).locator("[data-icon]")).toHaveAttribute("data-icon", "bus");
    await expect(routes.locator(`[data-route-id="${brtSunway.id}"]`)).toHaveCount(1);
    await expect(map.locator(".rail-alignment")).not.toHaveCount(0);
    await expect(map.locator(".linkbike-marker")).toHaveCount(0);

    // GPS ranking uses the actual position even while the overview is on Klang Valley.
    await nearby.getByRole("button", { name: "Enable Location" }).click();
    const recommendation = nearby.getByRole("button", { name: "View on Map: Penang GTFS test stop" });
    await expect(recommendation).toBeVisible();
    await recommendation.click();
    await expect(selector).toHaveValue("Penang");
    await expect(map.locator(".bus-search-popup")).toContainText(penangStop.name);
    await expect(recommendation).toHaveAttribute("aria-current", "true");
    await nearby.getByRole("button", { name: "Clear selection" }).click();
    await expect(routes.locator("strong")).toHaveText("2");
    await expect(routes.locator("[data-route-id]")).toHaveText(["301", "302"]);
    await expect(vehicles.locator("strong")).toHaveText("0");
    await expect(map.locator(".rail-alignment, .estimated-train-icon, .bus-vehicle-icon, .brt-alignment")).toHaveCount(0);
    await expect(map).toHaveAttribute("data-static-bus-stops", "1");
    await expect(map.locator(".linkbike-marker")).toHaveCount(27);
    await expect(page.locator("#map .panel-title")).toContainText("1 stations and stops");
    const busRoute = page.getByRole("combobox", { name: "Bus route" });
    await busRoute.selectOption("fixture-302");
    await expect(routes.locator("[data-route-id]")).toHaveText(["302"]);

    await chooseSearchStation(page, "Tun Razak Exchange", "Tun Razak");
    await expect(selector).toHaveValue("Klang Valley");
    await expect(map.locator(".rail-station-popup")).toContainText("Tun Razak Exchange");
    await page.getByRole("button", { name: "Reset dashboard" }).click();
    await expect(map.locator(".rail-alignment")).not.toHaveCount(0);
    await selector.selectOption("Penang");
    await expect(map).toHaveAttribute("data-camera-latitude", /^5\./);
    await expect(page.getByRole("button", { name: "Back to Home" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
  });
}
