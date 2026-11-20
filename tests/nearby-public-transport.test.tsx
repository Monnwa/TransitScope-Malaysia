import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NearbyPublicTransport, { useNearbyLocation } from "@/components/nearby-public-transport";
import { nearbyTransitCandidates, type NearbyCandidate } from "@/lib/nearby-transit";
import { railNetwork } from "@/lib/simulation/network";

const candidates = nearbyTransitCandidates(railNetwork, []);
let success: PositionCallback;
let failure: PositionErrorCallback;
const getCurrentPosition = vi.fn((onSuccess: PositionCallback, onError: PositionErrorCallback) => {
  success = onSuccess;
  failure = onError;
});
const original = Object.getOwnPropertyDescriptor(navigator, "geolocation");

function mockPosition(latitude = 3.145, longitude = 101.715, accuracy = 5) {
  act(() => success({ coords: { latitude, longitude, accuracy } } as GeolocationPosition));
}

function renderPanel() {
  const onSelect = vi.fn(), onClear = vi.fn();
  function Harness() {
    const location = useNearbyLocation();
    const [selectedId, select] = React.useState<string>();
    return <NearbyPublicTransport {...location} candidates={candidates} busCoverage="ready" routeColours={new Map()}
      selectedId={selectedId} onSelect={(candidate: NearbyCandidate) => { select(candidate.id); onSelect(candidate); }}
      onClear={() => { select(undefined); onClear(); }}/>;
  }
  render(<Harness/>);
  return { onSelect, onClear };
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  vi.stubGlobal("isSecureContext", true);
  getCurrentPosition.mockClear();
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "geolocation");
  if (original) Object.defineProperty(navigator, "geolocation", original);
});

describe("nearby transport panel", () => {
  it("requests location only after Enable Location and announces loading", () => {
    renderPanel();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    click("Enable Location");
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Finding your location");
    expect(screen.queryByRole("button", { name: "Enable Location" })).not.toBeInTheDocument();
  });

  it.each([[1, /denied/], [2, /unavailable/], [3, /took too long/]] as const)(
    "announces geolocation error %d and offers retry", (code, copy) => {
      renderPanel();
      click("Enable Location");
      act(() => failure({ code } as GeolocationPositionError));
      expect(screen.getByRole("status")).toHaveTextContent(copy);
      click("Retry Location");
      expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    });

  it("handles browsers without geolocation", () => {
    Reflect.deleteProperty(navigator, "geolocation");
    renderPanel();
    click("Enable Location");
    expect(screen.getByRole("status")).toHaveTextContent("does not support location");
  });

  it("renders five results, expands, collapses, selects and clears a recommendation", () => {
    const { onSelect, onClear } = renderPanel();
    click("Enable Location");
    mockPosition();
    expect(screen.getByRole("status")).toHaveTextContent("straight-line");
    const results = () => screen.getAllByRole("button", { name: /View on Map/ });
    expect(results()).toHaveLength(5);
    click("Show More");
    expect(results().length).toBeGreaterThan(5);
    click("Show Less");
    expect(results()).toHaveLength(5);
    fireEvent.click(results()[0]);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ position: expect.any(Array) }));
    expect(results()[0]).toHaveAttribute("aria-current", "true");
    click("Clear selection");
    expect(onClear).toHaveBeenCalledOnce();
    expect(results()[0]).not.toHaveAttribute("aria-current");
  });

  it("refreshes, keeps prior results during refresh, and shows an empty result for the updated location", () => {
    renderPanel();
    click("Enable Location");
    mockPosition(undefined, undefined, 200);
    expect(screen.getByText(/accuracy is low/)).toBeInTheDocument();
    click("Refresh Location");
    expect(screen.getByText(/last location/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /View on Map/ })).toHaveLength(5);
    mockPosition(0, 0);
    expect(screen.getByText("No public transport locations found within 3 km.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View on Map/ })).not.toBeInTheDocument();
  });
});
