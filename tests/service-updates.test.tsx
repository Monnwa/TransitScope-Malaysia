import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ServiceUpdates from "@/components/service-updates";
import { resolveServiceImpact, serviceAlertMatchesTransport, summarizeServiceAlerts } from "@/lib/service-impact";
import { simulationAlerts } from "@/lib/simulation/scenarios";
import { busStops, railNetwork } from "@/lib/simulation/network";
import { buildStationSearchIndex, resolveAlertStations } from "@/lib/station-search";

const alerts = simulationAlerts(Date.parse("2026-11-20T06:00:00Z"));
afterEach(cleanup);

describe("affected stations", () => {
  it("resolves the existing rail records by canonical ID or exact route-qualified name", () => {
    const index = buildStationSearchIndex(railNetwork, [], []);
    const expected = alerts[1].stations.map(name => railNetwork.stations.find(station => station.name === name)!);
    const matches = resolveAlertStations(index, [expected[0].id, ...alerts[1].stations], alerts[1].routeIds);
    expect(matches.map(station => [station.id, station.position])).toEqual(expected.map(station => [station.id, station.position]));
    expect(resolveAlertStations(index, ["unknown-station", "Kajang", expected[0].name], ["LRT-PH"])).toEqual([]);
  });

  it("rejects unavailable coordinates and resolves bus stops through their exact feed ID and route", () => {
    const station = railNetwork.stations.find(record => record.name === alerts[0].stations[0])!;
    const bus = busStops.find(stop => stop.routeId === "T401" && stop.position && stop.stopRefs?.length)!;
    const sourceId = bus.stopRefs![0].split(":").at(-1)!;
    const index = buildStationSearchIndex({ ...railNetwork, stations: [{ ...station, position: null }] }, [{
      id: `bus-stop:rapid-bus-mrtfeeder:${sourceId}`, sourceId, name: bus.name, position: bus.position!,
      operator: bus.operator, feed: "MRT Feeder Bus", aliases: [], routes: [{ id: "T401", name: "T401" }],
    }], []);
    expect(resolveAlertStations(index, [station.id, station.name], alerts[0].routeIds)).toEqual([]);
    expect(resolveAlertStations(index, [sourceId], ["T402"])).toEqual([]);
    expect(resolveAlertStations(index, [sourceId], ["T401"])[0]).toMatchObject({ type: "BUS_STOP", position: bus.position });
  });
});

describe("service impact", () => {
  it("prioritizes source severity and impact over normalized metadata", () => {
    expect(resolveServiceImpact({ severity: " High ", impact: "low", classificationSeverity: "MEDIUM" })).toBe("high");
    expect(resolveServiceImpact({ severity: "unknown", impact: "Medium", classificationSeverity: "HIGH" })).toBe("medium");
    expect(resolveServiceImpact({ classificationSeverity: "HIGH" })).toBe("high");
    expect(resolveServiceImpact({ severity: "INFO", classificationSeverity: "HIGH" })).toBe("low");
  });

  it("uses a conservative category fallback and never infers High", () => {
    expect(resolveServiceImpact({ category: "DELAY" })).toBe("medium");
    expect(resolveServiceImpact({ category: "Maintenance", classificationSeverity: "UNKNOWN" })).toBe("medium");
    expect(resolveServiceImpact({ category: "Disruption", severity: "unexpected" })).toBe("low");
    expect(resolveServiceImpact({})).toBe("low");
  });

  it("orders by severity then latest valid time, preserving source order for undated notices", () => {
    const items = [
      { id: "undated", severity: "Medium", updatedAt: "invalid" },
      { id: "started", severity: "Medium", updatedAt: "invalid", startedAt: "2026-11-18T01:00:00Z" },
      { id: "high", severity: "High" },
      { id: "also undated", severity: "Medium" },
      { id: "updated", severity: "Medium", updatedAt: "2026-11-20T01:00:00Z", startedAt: "2026-11-17T01:00:00Z" },
      { id: "low", severity: "Low", updatedAt: "2026-11-21T01:00:00Z" },
    ];
    const { counts, ordered } = summarizeServiceAlerts(items);
    expect(counts).toEqual({ high: 1, medium: 4, low: 1 });
    expect(ordered.map(({ alert }) => alert.id)).toEqual(["high", "updated", "started", "undated", "also undated", "low"]);
  });

  it("keeps general notices visible and applies bus route filtering only to bus notices with route IDs", () => {
    const route = (id?: string) => id === "T401";
    expect(serviceAlertMatchesTransport({ modes: [], routeIds: [] }, [], route)).toBe(true);
    expect(serviceAlertMatchesTransport({ modes: ["Bus"], routeIds: [] }, ["Bus"], route)).toBe(true);
    expect(serviceAlertMatchesTransport({ modes: ["Bus"], routeIds: ["T402"] }, ["Bus"], route)).toBe(false);
    expect(serviceAlertMatchesTransport({ modes: ["Bus"], routeIds: ["T401"] }, ["MRT"], route)).toBe(false);
    expect(serviceAlertMatchesTransport({ modes: ["Bus", "MRT"], routeIds: ["T402", "MRT1"] }, ["MRT"], route)).toBe(true);
  });
});

describe("Overview service updates", () => {
  const props = { expanded: false, filter: "All", onFilter: vi.fn(), onToggle: vi.fn(), onSelectStation: vi.fn() };

  it("derives KPI and list counts from the same filtered dataset and updates when notices change", () => {
    const view = render(<ServiceUpdates {...props} state={{ status: "ready", alerts }}/>);
    const toggle = screen.getByRole("button", { name: "Service updates" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "alerts");
    expect(toggle.querySelector("strong")).toHaveTextContent("3");
    expect(within(toggle).getByText("1 High").closest(".service-impact")).toHaveAttribute("data-tone", "danger");
    expect(within(toggle).getByText("1 Medium").closest(".service-impact")).toHaveAttribute("data-tone", "warning");
    expect(within(toggle).getByText("1 Low").closest(".service-impact")).toHaveAttribute("data-tone", "info");
    expect(screen.queryByRole("region", { name: "Service alerts" })).not.toBeInTheDocument();

    view.rerender(<ServiceUpdates {...props} expanded filter="Delay" state={{ status: "ready", alerts: alerts.slice(1, 2) }}/>);
    expect(toggle.querySelector("strong")).toHaveTextContent("1");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    view.rerender(<ServiceUpdates {...props} expanded state={{ status: "ready", alerts: alerts.slice(1) }}/>);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle.querySelector("strong")).toHaveTextContent("2");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("distinguishes empty, loading and error states", () => {
    const view = render(<ServiceUpdates {...props} expanded state={{ status: "ready", alerts: [] }}/>);
    expect(screen.getByRole("status")).toHaveTextContent("No active service alerts");
    expect(screen.getByText("0")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Service alerts" })).not.toBeInTheDocument();
    view.rerender(<ServiceUpdates {...props} state={{ status: "loading" }}/>);
    expect(screen.getByRole("status")).toHaveTextContent("Loading service alerts");
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    view.rerender(<ServiceUpdates {...props} state={{ status: "error" }}/>);
    expect(screen.getByRole("status")).toHaveTextContent("Service alerts are unavailable");
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("preserves source metadata, timestamps and nested actions", async () => {
    const sourceUrl = "https://myrapid.com.my/test-notice/";
    const alert = { ...alerts[0], sourceUrl };
    const onToggle = vi.fn();
    const onSelectStation = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<ServiceUpdates {...props} onToggle={onToggle} onSelectStation={onSelectStation}
      expanded state={{ status: "ready", alerts: [alert, ...alerts.slice(1)] }}/>);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(alerts.length);
    for (const [index, item] of alerts.entries()) {
      const row = within(rows[index]);
      expect(row.getByRole("heading", { name: item.title })).toBeVisible();
      expect(row.getByText(item.description)).toBeVisible();
      expect(row.getByText(item.source)).toBeVisible();
      const icon = rows[index].querySelector(".service-impact svg");
      expect(icon).toHaveAttribute("aria-hidden", "true");
      expect(icon?.innerHTML).toBe(within(screen.getByRole("button", { name: "Service updates" }))
        .getByText(`1 ${item.severity}`).closest(".service-impact")?.querySelector("svg")?.innerHTML);
      for (const route of item.routes) expect(rows[index]).toHaveTextContent(route);
      for (const station of item.stations) expect(rows[index]).toHaveTextContent(station);
    }
    expect(container.querySelector("time")).toHaveAttribute("datetime", alert.startedAt);
    const sourceLink = screen.getByRole("link", { name: "View original announcement" });
    expect(sourceLink).toHaveAttribute("href", sourceUrl);
    sourceLink.addEventListener("click", event => event.preventDefault());
    await user.click(sourceLink);
    await user.click(within(rows[0]).getByRole("button", { name: "Show affected station on map" }));
    expect(onSelectStation).toHaveBeenCalledWith(alert);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
