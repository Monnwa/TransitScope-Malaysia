import type { Locator } from "@playwright/test";

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
