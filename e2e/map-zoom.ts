import { expect, type Locator } from "@playwright/test";

/** Existing popup/marker fixtures need zoom 12 regardless of the new route overview fit. */
export async function setMapZoom(map: Locator, target: number) {
  await expect(map).toHaveAttribute("data-bus-zoom", /\d+/);
  for (let step = 0; step < 18; step++) {
    const current = Number(await map.getAttribute("data-bus-zoom"));
    if (current === target) return;
    await map.getByRole("button", { name: current < target ? "Zoom in" : "Zoom out", exact: true }).click();
    await expect(map).not.toHaveAttribute("data-bus-zoom", String(current));
    await expect(map).not.toHaveClass(/leaflet-zoom-anim/);
  }
  throw new Error("Map did not reach zoom " + target);
}
