import {afterEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
import {buildTimetable} from "@/lib/scheduled-departures";
vi.mock("@/lib/official-transit",()=>({getTimetable:vi.fn()}));
import {getTimetable} from "@/lib/official-transit";
import {GET} from "@/app/api/departures/route";
const build=(sunday="1",year="2026")=>buildTimetable({stopTimes:[{stop_id:"S",trip_id:"T",departure_time:"06:00:00",stop_sequence:"1"},{stop_id:"E",trip_id:"T",departure_time:"07:00:00",stop_sequence:"2"}],trips:[{trip_id:"T",route_id:"R",service_id:"D"}],routes:[{route_id:"R"}],stops:[{stop_id:"S"}],calendars:[{service_id:"D",start_date:year+"0101",end_date:year+"1231",monday:"1",tuesday:"1",wednesday:"1",thursday:"1",friday:"1",saturday:"1",sunday}],exceptions:[],frequencies:[],source:"Synthetic unit fixture",mode:()=>"MRT"});
afterEach(()=>{vi.useRealTimers();vi.resetAllMocks();});
describe("additive empty-state response metadata",()=>{
  it("terminal train arrivals do not inherit the legacy no-onward-departures state",async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-01T06:00:00+08:00"));const table=build();
    table.arrivalStops.set("E",[{stop_id:"E",trip_id:"T",arrival_time:"07:00:00",departure_time:"07:00:00",stop_sequence:"2"}]);
    vi.mocked(getTimetable).mockResolvedValue(table);
    const result=await(await GET(new NextRequest("https://example.test/api/departures?stop=rapid-rail-kl:E"))).json();
    expect(result.emptyReason).toBeNull();expect(result.trainArrivals[0].classification).toBe("SCHEDULED");expect(result.departures).toEqual([]);expect(result.liveEta.available).toBe(false);
  });
  it("distinguishes valid-calendar no-service days from missing timetables",async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-01T06:00:00+08:00"));vi.mocked(getTimetable).mockResolvedValue(build("0"));
    const result=await(await GET(new NextRequest("https://example.test/api/departures?stop=rapid-rail-kl:S"))).json();expect(result.emptyReason).toBe("NO_SERVICE_TODAY");expect(result.departures).toHaveLength(1);
  });
  it("labels a finished service day without losing tomorrow's services",async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-01T20:00:00+08:00"));vi.mocked(getTimetable).mockResolvedValue(build());
    const result=await(await GET(new NextRequest("https://example.test/api/departures?stop=rapid-rail-kl:S"))).json();expect(result.emptyReason).toBe("NO_MORE_TODAY");expect(result.departures).toHaveLength(1);
  });
  it("does not label an expired calendar as a confirmed service closure",async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-01T06:00:00+08:00"));vi.mocked(getTimetable).mockResolvedValue(build("1","2025"));
    const result=await(await GET(new NextRequest("https://example.test/api/departures?stop=rapid-rail-kl:S"))).json();expect(result.emptyReason).toBe("TIMETABLE_UNAVAILABLE");
  });
});
