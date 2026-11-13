import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StationOperations from "@/components/station-operations";
import { erlServiceStatus, parseOfficialAnnouncements } from "@/lib/official-alerts";
import type { AlertPayload, OfficialAlert } from "@/lib/official-alert-model";
import { bandarTasikSelatan, getStationOperations, stationServiceLabel } from "@/lib/station-operations";

function scenario(now = Date.now()) {
  const timestamp = new Date(now - 5 * 60_000).toISOString();
  const source = "Rapid KL Official RSS";
  const alert: OfficialAlert = {
    id: "closure", title: "Bandar Tasik Selatan station closed towards Putra Heights",
    description: "Board the replacement shuttle bus from the signed pickup point.",
    severity: "High", routes: ["LRT Sri Petaling Line"], stations: [],
    startedAt: timestamp, endsAt: null, source, dataMode: "STATIC", category: "CLOSURE",
    classificationSeverity: "HIGH", affectedModes: ["LRT", "Bus"], affectedLineIds: ["LRT-PH"],
    sourceName: source, sourceType: "OFFICIAL_WEBSITE", sourceUrl: "https://myrapid.com.my/fixture/",
    publishedAt: timestamp, retrievedAt: timestamp, alertStatus: "ACTIVE", stale: false,
  };
  const payload: AlertPayload = { alerts: [alert], retrievedAt: timestamp, sources: [
    { name: source, status: "healthy", url: "https://myrapid.com.my/feed/", lastSuccessAt: timestamp, message: null },
    { name: "ERL Service Updates", status: "healthy", url: "https://www.kliaekspres.com/happenings/service-updates/",
      lastSuccessAt: timestamp, message: null, serviceStatus: "NORMAL" },
  ] };
  return { now, payload, alert };
}

describe("station operations", () => {
  it("scopes an explicit rail closure and its shuttle to the named station and direction", () => {
    const { now, payload } = scenario();
    const [lrt, ktm, erl, buses] = getStationOperations(bandarTasikSelatan, payload, false, now);
    expect(lrt.notices[0]).toMatchObject({ scope: "At this station", direction: "Putra Heights", current: true });
    expect(lrt.notices[0].alternative).toContain("replacement shuttle bus");
    expect(stationServiceLabel(lrt, lrt.notices)).toBe("Station closure reported");
    expect(ktm.notices).toEqual([]);
    expect(buses.notices).toEqual([]);
    expect(stationServiceLabel(erl, erl.notices)).toBe("Operator network reports normal");
  });

  it("keeps line notices distinct from station closures and suppresses expired and restored items", () => {
    const { now, payload, alert } = scenario();
    payload.alerts = [
      { ...alert, title: "Sri Petaling Line disruption", description: "Check station signs.", category: "DISRUPTION" },
      { ...alert, id: "restored", alertStatus: "RESOLVED" },
      { ...alert, id: "expired", validUntil: new Date(now - 1).toISOString() },
    ];
    const [lrt] = getStationOperations(bandarTasikSelatan, payload, false, now);
    expect(lrt.notices.map(notice => notice.scope)).toEqual(["Line notice"]);
    expect(stationServiceLabel(lrt, lrt.notices)).toBe("Check service notice");
  });

  it("keeps earlier notices available without turning stale sources into current conditions", () => {
    const { now, payload } = scenario();
    const [lrt, , erl] = getStationOperations(bandarTasikSelatan, payload, true, now);
    expect(lrt.notices[0].current).toBe(false);
    expect(erl.networkStatus).toBeUndefined();
    expect(stationServiceLabel(lrt, lrt.notices)).toBe("Station status unavailable");
  });

  it("allows riders to isolate a service and direction in the hub panel", () => {
    const { payload } = scenario();
    render(<StationOperations record={bandarTasikSelatan} payload={payload} refreshFailed={false}/>);
    const panel = screen.getByRole("region", { name: "Station operations" });
    expect(within(panel).getByRole("heading", { name: "TBS express buses" })).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText("Service"), { target: { value: "LRT-PH" } });
    expect(within(panel).getByText("Station closure reported")).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText("Direction"), { target: { value: "Sentul Timur" } });
    expect(within(panel).queryByText("Station closure reported")).not.toBeInTheDocument();
    expect(within(panel).getByText("No current notice found")).toBeInTheDocument();
  });

  it("reads ERL's network banner and its dated official timetable announcement", () => {
    const html = '<a class="nav-link statusinfo"><span>Train Service Status:</span> Normal</a>' +
      '<div class="itemgroup-cards"><h5>Additional Train Service for KLIA Transit</h5>' +
      '<p>Extra airport service.</p><p class="small-info">03 Jan 2026</p>' +
      '<a href="/media/notice.pdf" class="stretched-link"></a></div>';
    expect(erlServiceStatus(html)).toBe("NORMAL");
    expect(erlServiceStatus("<p>Train Service Status: Normal</p>")).toBeUndefined();
    expect(parseOfficialAnnouncements(html, "ERL Service Updates",
      "https://www.kliaekspres.com/happenings/service-updates/", "erl", "2026-01-03T01:00:00Z")).toEqual([
      expect.objectContaining({ affectedLineIds: ["ERL-TRANSIT"], category: "SCHEDULE_CHANGE",
        publishedAt: "2026-01-02T16:00:00.000Z", description: "Extra airport service." }),
    ]);
  });
});
