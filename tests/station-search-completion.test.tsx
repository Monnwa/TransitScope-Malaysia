import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useStationSearch from "@/components/use-station-search";
import { railNetwork } from "@/lib/simulation/network";
import { normaliseSearchText, resolveExactStation, STATION_SEARCH_COMPLETION_MS } from "@/lib/station-search";

const trx = railNetwork.stations.find(station => station.name === "Tun Razak Exchange")!;
const midah = railNetwork.stations.find(station => station.name === "Taman Midah")!;
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("exact station matching", () => {
  it.each(["Tun Razak Exchange", "tun razak exchange", "  TUN   Razak\t Exchange  ", "MRT Tun Razak Exchange station", "Ｔｕｎ Razak Exchange"])("resolves %s to the same canonical TRX record", query => {
    expect(resolveExactStation(query, railNetwork)).toBe(trx);
  });
  it("normalizes the filter text and reuses existing station aliases", () => {
    expect(normaliseSearchText("  Tun  Razak\tExchange  ")).toBe("Tun Razak Exchange");
    expect(resolveExactStation("TBS", railNetwork)?.name).toBe("Bandar Tasik Selatan");
    expect(resolveExactStation("Putrajaya and Cyberjaya", railNetwork)?.name).toBe("Putrajaya Sentral");
  });
  it.each(["", "  ", "Tun Razak", "Sentral", "MRT1", "Bus T401-01"])("does not treat %s as an exact station", query => {
    expect(resolveExactStation(query, railNetwork)).toBeUndefined();
  });
  it("rejects duplicate names, including when one matching record has invalid coordinates", () => {
    const duplicate = { ...trx, id: "another-trx", position: null };
    expect(resolveExactStation(trx.name, { ...railNetwork, stations: [trx, duplicate] })).toBeUndefined();
    expect(resolveExactStation(trx.name, { ...railNetwork, stations: [{ ...trx, position: [NaN, 101] }] })).toBeUndefined();
  });
});

describe("station input completion and explicit selection", () => {
  function setup(query = "Tun Razak Exchange") {
    vi.useFakeTimers();
    const selected = vi.fn();
    const view = renderHook(({ text }) => useStationSearch(railNetwork, text, resolveExactStation(text, railNetwork), selected),
      { initialProps: { text: query } });
    return { ...view, selected };
  }
  it("waits for exact input completion and selects the canonical record and coordinates once", () => {
    const { result, selected, rerender } = setup();
    act(() => vi.advanceTimersByTime(STATION_SEARCH_COMPLETION_MS - 1)); expect(selected).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1)); expect(selected).toHaveBeenCalledExactlyOnceWith(trx);
    expect(selected.mock.calls[0][0].position).toEqual(trx.position);
    expect(result.current.request?.stationId).toBe(trx.id);
    rerender({ text: trx.name }); act(() => vi.advanceTimersByTime(5000)); expect(selected).toHaveBeenCalledOnce();
  });
  it("never navigates for partial, ambiguous or cleared input", () => {
    const { result, selected, rerender } = setup("Tun Razak");
    act(() => vi.advanceTimersByTime(5000)); expect(selected).not.toHaveBeenCalled();
    rerender({ text: trx.name }); rerender({ text: "" });
    act(() => vi.advanceTimersByTime(5000)); expect(result.current.request).toBeNull(); expect(selected).not.toHaveBeenCalled();
  });
  it("explicit View details works without a query and cancels pending exact completion", () => {
    const { result, selected } = setup();
    act(() => result.current.select(midah));
    act(() => vi.advanceTimersByTime(5000));
    expect(selected).toHaveBeenCalledExactlyOnceWith(midah);
    expect(result.current.request?.stationId).toBe(midah.id);
  });
  it("rapid queries and explicit selections cannot replay an older station", () => {
    const { result, selected, rerender } = setup();
    rerender({ text: midah.name }); act(() => vi.advanceTimersByTime(STATION_SEARCH_COMPLETION_MS));
    expect(selected).toHaveBeenCalledExactlyOnceWith(midah);
    act(() => result.current.select(trx)); act(() => result.current.select(midah));
    expect(result.current.request?.stationId).toBe(midah.id);
    const revision = result.current.request?.revision;
    act(() => result.current.select(midah)); expect(result.current.request?.revision).toBeGreaterThan(revision!);
    act(() => vi.advanceTimersByTime(5000)); expect(selected).toHaveBeenCalledTimes(4);
  });
  it("cancel and unmount retire pending completion and existing popup requests", () => {
    const { result, selected, unmount } = setup();
    act(() => result.current.cancel()); act(() => vi.advanceTimersByTime(5000)); expect(selected).not.toHaveBeenCalled();
    act(() => result.current.select(trx)); act(() => result.current.cancel()); expect(result.current.request).toBeNull();
    unmount(); act(() => vi.advanceTimersByTime(5000)); expect(selected).toHaveBeenCalledOnce();
  });
});
