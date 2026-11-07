import {describe,expect,it} from "vitest";
import {availableDepartures,boardTime,emptyBoardMessage,safeTimetableSource,type DeparturePayload} from "@/lib/departure-board";
import type {ScheduledDeparture} from "@/lib/scheduled-departures";
describe("departure board presentation",()=>{
  it("uses 24-hour Malaysia times even across midnight",()=>{expect(boardTime("2026-11-07T16:10:00Z")).toBe("00:10");expect(boardTime("2026-11-07T06:32:49Z")).toBe("14:32");});
  it("omits passed timestamps and preserves upcoming chronological ordering",()=>{
    const rows=["2026-11-07T07:00Z","2026-11-07T05:00Z","2026-11-07T06:30Z"].map(scheduledDeparture=>({scheduledDeparture} as ScheduledDeparture));expect(availableDepartures(rows,Date.parse("2026-11-07T06:00Z")).map(row=>row.scheduledDeparture)).toEqual(["2026-11-07T06:30Z","2026-11-07T07:00Z"]);
  });
  it("distinguishes explicit empty-state reasons without guessing service calendars",()=>{
    expect(emptyBoardMessage({emptyReason:"NO_SERVICE_TODAY"} as DeparturePayload)).toBe("No scheduled service for today.");expect(emptyBoardMessage({emptyReason:"NO_MORE_TODAY"} as DeparturePayload)).toBe("No more scheduled departures today.");expect(emptyBoardMessage({emptyReason:"TIMETABLE_UNAVAILABLE"} as DeparturePayload)).toBe("Scheduled departure information is currently unavailable.");
  });
  it("allows existing official source links and rejects unsafe destinations",()=>{expect(safeTimetableSource("https://api.data.gov.my/gtfs-static/ktmb")).toBe(true);expect(safeTimetableSource("javascript:alert(1)")).toBe(false);expect(safeTimetableSource("https://api.data.gov.my.attacker.invalid/")).toBe(false);});
});
