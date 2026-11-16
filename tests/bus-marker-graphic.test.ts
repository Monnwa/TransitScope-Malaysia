import { describe, expect, it } from "vitest";
import { busMarkerGraphic } from "@/components/bus-marker-graphic";

function renderedForwardVector(heading?: number | null) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = busMarkerGraphic(heading);
  const cue = wrapper.querySelector(".bus-forward-cue")!;
  const [x, y] = cue.getAttribute("d")!.slice(1).split(/[ l]/).slice(0, 2).map(Number);
  const [degrees, cx, cy] = cue.parentElement!.getAttribute("transform")!.slice(7, -1).split(" ").map(Number);
  const radians = degrees * Math.PI / 180;
  return [
    Math.round((x - cx) * Math.cos(radians) - (y - cy) * Math.sin(radians)),
    Math.round((x - cx) * Math.sin(radians) + (y - cy) * Math.cos(radians)),
  ].map(value => value || 0);
}

describe("front-facing bus icon", () => {
  it.each([
    ["north", 0, [0, -14]],
    ["east", 90, [14, 0]],
    ["south", 180, [0, 14]],
    ["west", 270, [-14, 0]],
    ["rounded north", 360, [0, -14]],
  ])("points its rendered forward cue to %s", (_, heading, vector) => {
    expect(renderedForwardVector(heading)).toEqual(vector);
  });

  it.each([undefined, null, NaN, Infinity, -5, 361])("points north for invalid or missing bearing %s", heading => {
    expect(renderedForwardVector(heading)).toEqual([0, -14]);
  });
});
