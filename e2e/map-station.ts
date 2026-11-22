import { expect, type Locator, type Page } from "@playwright/test";

export const transportSearch = (page: Page) => page.getByRole("textbox", { name: "Search vehicles, routes or stations" });

export async function chooseSearchStation(page: Page, name: string, query = name.slice(0, -1)) {
  const search = transportSearch(page);
  if (await search.inputValue() === query) await search.click();
  else await search.fill(query);
  await page.getByRole("listbox", { name: "Station search results" }).getByRole("option")
    .filter({ has: page.getByText(name, { exact: true }) }).click({ timeout: 10_000 });
}

export async function selectVehicle(page: Page, name: string) {
  await page.getByRole("combobox", { name: "Vehicle details" }).selectOption({ label: name });
}

export async function selectSimulatedBusStop(page: Page, name: string) {
  await transportSearch(page).fill(name);
  const stop = page.locator(".bus-network-stop").first();
  await expect(stop).toBeAttached();
  await stop.dispatchEvent("click");
}

export async function railMarkerAt(map: Locator, position: [number, number]) {
  const markers = map.locator('.rail-station:not([d="M0 0"])');
  let match = -1;
  await expect.poll(async () => {
    match = await markers.evaluateAll((elements, [latitude, longitude]) => {
      const container = elements[0]?.closest(".leaflet-container");
      if (!container) return -1;
      const box = container.getBoundingClientRect();
      const scale = 256 * 2 ** Number(container.getAttribute("data-camera-zoom"));
      const centerLat = Number(container.getAttribute("data-camera-latitude"));
      const centerLng = Number(container.getAttribute("data-camera-longitude"));
      const mercator = (lat: number) => -Math.asinh(Math.tan(lat * Math.PI / 180)) / (2 * Math.PI) * scale;
      const x = box.left + box.width / 2 + (longitude - centerLng) * scale / 360;
      const y = box.top + box.height / 2 + mercator(latitude) - mercator(centerLat);
      return elements.findIndex(element => {
        const marker = element.getBoundingClientRect();
        return Math.hypot(marker.left + marker.width / 2 - x, marker.top + marker.height / 2 - y) <= 1.5;
      });
    }, position);
    return match;
  }).toBeGreaterThanOrEqual(0);
  return markers.nth(match);
}

/** Recover WGS84 from the actual rendered marker and camera, independently of navigation intent data. */
export async function renderedStationPosition(marker: Locator) {
  return marker.evaluate(element => {
    const map = element.closest(".leaflet-container")!, box = map.getBoundingClientRect(), pin = element.getBoundingClientRect();
    const latitude = Number(map.getAttribute("data-camera-latitude")), longitude = Number(map.getAttribute("data-camera-longitude"));
    const scale = 256 * 2 ** Number(map.getAttribute("data-camera-zoom"));
    const screenX = pin.left + pin.width / 2, screenY = pin.top + pin.height / 2;
    if (screenX < box.left || screenX > box.right || screenY < box.top || screenY > box.bottom) throw Error("Selected station is outside the map");
    const x = (longitude + 180) / 360 * scale + screenX - box.left - box.width / 2;
    const y = (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * scale + screenY - box.top - box.height / 2;
    return { latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI, longitude: x / scale * 360 - 180 };
  });
}
