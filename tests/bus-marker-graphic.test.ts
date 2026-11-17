import { createElement } from "react";
import { render } from "@testing-library/react";
import { MapContainer } from "react-leaflet";
import { describe, expect, it } from "vitest";
import BusVehicleMarker from "@/components/bus-vehicle-marker";
import { busRecords } from "@/lib/simulation/vehicles";

const record = busRecords(Date.parse("2026-11-14T04:00:00Z"))[0];
const position = record.position!;

function mapWithBus(bearing: number | null | undefined, active: boolean) {
  return createElement(MapContainer, { center: position, zoom: 13, zoomAnimation: false },
    createElement(BusVehicleMarker, { record: { ...record, position, bearing }, active, onSelect: () => {} }));
}

function uprightMarkup(container: HTMLElement) {
  const icon = container.querySelector(".bus-vehicle-icon")!;
  const svg = icon.querySelector("svg")!;
  const cue = svg.querySelector(".bus-forward-cue")!;
  const [x, y] = cue.getAttribute("d")!.match(/^M([\d.]+) ([\d.]+)/)!.slice(1).map(Number);
  const [left, top, width, height] = svg.getAttribute("viewBox")!.split(" ").map(Number);
  expect([x - (left + width / 2), y - (top + height / 2)]).toEqual([0, -14]);
  expect(svg.querySelector("[transform]")).toBeNull();
  expect(icon.getAttribute("style")).not.toMatch(/rotate\(/);
  return svg.outerHTML;
}

describe("the rendered Leaflet bus marker", () => {
  it.each([0, 45, 90, 135, 180, 225, 270, 315, undefined, null, NaN, Infinity, 361])(
    "faces screen-up at bearing %s in both selection states",
    bearing => {
      const { container, rerender } = render(mapWithBus(bearing, false));
      const unselected = uprightMarkup(container);
      expect(container.querySelector(".bus-vehicle-icon")).not.toHaveClass("vehicle-selected");
      rerender(mapWithBus(bearing, true));
      expect(container.querySelector(".bus-vehicle-icon")).toHaveClass("vehicle-selected");
      expect(uprightMarkup(container)).toBe(unselected);
    },
  );
});
