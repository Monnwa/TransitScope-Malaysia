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
  const graphic = icon.querySelector("img")!;
  expect(graphic).toHaveAttribute("src", "/markers/oncoming-bus.png");
  expect(graphic).toHaveAttribute("alt", "");
  expect(graphic).not.toHaveAttribute("style");
  expect(icon.getAttribute("style")).not.toMatch(/rotate\(/);
  return graphic.outerHTML;
}

describe("the rendered Leaflet bus marker", () => {
  it.each([0, 45, 90, 135, 180, 225, 270, 315, undefined, null, NaN, Infinity, 361])(
    "uses the upright Oncoming Bus at bearing %s in both selection states",
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
