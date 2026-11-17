import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BusCameraProvider, useBusCamera } from "@/components/bus-camera-context";

function Controls() {
  const { state, dispatch, guard } = useBusCamera();
  return <>
    <output aria-label="camera mode">{state.mode}</output>
    <output aria-label="vehicle identity">{state.vehicleId}</output>
    <button onClick={() => dispatch({ type: "FOCUS", available: true })}>Focus</button>
    <button onClick={() => dispatch({ type: "MANUAL" })}>Drag</button>
    <button onClick={() => dispatch({ type: "RETURN", available: true })}>Return</button>
    <button onClick={() => guard.run(() => { if (!guard.active) dispatch({ type: "MANUAL" }); })}>Programmatic zoom</button>
  </>;
}
describe("shared camera ownership", () => {
  it("preserves mode across polling renders, distinguishes selection/focus and never transfers following", () => {
    const view = (id: string | null) => <BusCameraProvider selectedVehicleId={id}><Controls/></BusCameraProvider>;
    const { rerender } = render(view(null));
    rerender(view("bus:T401:01"));
    expect(screen.getByLabelText("camera mode")).toHaveTextContent("OVERVIEW");
    fireEvent.click(screen.getByText("Focus"));
    rerender(view("bus:T401:01"));
    expect(screen.getByLabelText("camera mode")).toHaveTextContent("VEHICLE_FOCUS");
    fireEvent.click(screen.getByText("Programmatic zoom"));
    expect(screen.getByLabelText("camera mode")).toHaveTextContent("VEHICLE_FOCUS");
    fireEvent.click(screen.getByText("Drag"));
    rerender(view("bus:T401:01"));
    expect(screen.getByLabelText("camera mode")).toHaveTextContent("FREE_EXPLORE");
    fireEvent.click(screen.getByText("Return"));
    expect(screen.getByLabelText("camera mode")).toHaveTextContent("VEHICLE_FOCUS");
    rerender(view("bus:T402:01"));
    expect(screen.getByLabelText("camera mode")).toHaveTextContent("FREE_EXPLORE");
    expect(screen.getByLabelText("vehicle identity")).toHaveTextContent("bus:T402:01");
    rerender(view(null));
    expect(screen.getByLabelText("camera mode")).toHaveTextContent("OVERVIEW");
  });
});
