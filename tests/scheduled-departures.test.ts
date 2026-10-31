import { describe,expect,it } from "vitest";
import { buildTimetable,calculateDepartures,gtfsSeconds,serviceRuns } from "@/lib/scheduled-departures";
const calendar={service_id:"daily",monday:"1",tuesday:"1",wednesday:"1",thursday:"1",friday:"1",saturday:"1",sunday:"1",start_date:"20260101",end_date:"20261231"};
function table(options:{times?:string[];frequencies?:Record<string,string>[];exceptions?:Record<string,string>[];calendars?:Record<string,string>[]}={}) {
  return buildTimetable({stopTimes:(options.times??["23:55:00","24:10:00","25:15:00"]).flatMap((time,i)=>[{trip_id:`trip${i}`,stop_id:"s",stop_sequence:"1",departure_time:time},{trip_id:`trip${i}`,stop_id:"end",stop_sequence:"2",departure_time:time}]),trips:[0,1,2].map(i=>({trip_id:`trip${i}`,route_id:"r",service_id:"daily",trip_headsign:"Test terminus",direction_id:"0"})),routes:[{route_id:"r",route_long_name:"Fixture service"}],stops:[{stop_id:"s",stop_name:"Test stop",platform_code:"2"}],calendars:options.calendars??[calendar],exceptions:options.exceptions??[],frequencies:options.frequencies??[],source:"Official-source test fixture only",mode:()=>"MRT"});
}
describe("official scheduled departure calculations",()=>{
  it("excludes terminal-only arrivals from departures",()=>expect(calculateDepartures(table(),["end"],Date.parse("2026-11-01T00:05:00+08:00")).departures).toHaveLength(0));
  it("parses extended service hours without rolling twice",()=>{expect(gtfsSeconds("25:15:00")).toBe(90900);expect(gtfsSeconds("10:99:00")).toBeNull();});
  it("uses the previous service day for after-midnight trips in MYT",()=>{
    const result=calculateDepartures(table(),["s"],Date.parse("2026-11-01T00:05:00+08:00"));
    expect(result.departures[0].scheduledDeparture).toBe("2026-10-31T16:10:00.000Z");expect(result.departures[1].scheduledDeparture).toBe("2026-10-31T17:15:00.000Z");
  });
  it("applies removal and addition exceptions including exception-only calendars",()=>{
    expect(serviceRuns(table({exceptions:[{service_id:"daily",date:"20261101",exception_type:"2"}]}),"daily","2026-11-01")).toBe(false);
    expect(serviceRuns(table({calendars:[],exceptions:[{service_id:"daily",date:"20261101",exception_type:"1"}]}),"daily","2026-11-01")).toBe(true);
  });
  it("checks weekdays and validity dates explicitly",()=>{
    const t=table({calendars:[{...calendar,sunday:"0"}]});expect(serviceRuns(t,"daily","2026-11-01")).toBe(false);expect(serviceRuns(t,"daily","2027-01-01")).toBe(false);
  });
  it("does not fabricate exact departure times from non-exact frequencies",()=>{
    const t=table({times:["06:00:00"],frequencies:[{trip_id:"trip0",start_time:"06:00:00",end_time:"23:00:00",headway_secs:"180"}]});
    const r=calculateDepartures(t,["s"],Date.parse("2026-11-01T14:00:00+08:00"));expect(r.departures).toHaveLength(0);expect(r.frequencies[0].headwaySeconds).toBe(180);
  });
  it("expands only exact_times=1 and deduplicates shared stop inputs",()=>{
    const t=table({times:["06:00:00"],frequencies:[{trip_id:"trip0",start_time:"06:00:00",end_time:"23:00:00",headway_secs:"300",exact_times:"1"}]});
    const r=calculateDepartures(t,["s","s"],Date.parse("2026-11-01T14:01:00+08:00"));expect(r.departures[0].scheduledDeparture).toBe("2026-11-01T06:05:00.000Z");expect(r.departures).toHaveLength(10);
  });
  it("keeps upcoming tomorrow services while reporting no services left today",()=>{
    const r=calculateDepartures(table({times:["06:00:00"]}),["s"],Date.parse("2026-11-01T23:00:00+08:00"));expect(r.noMoreToday).toBe(true);expect(r.departures[0].scheduledDeparture).toBe("2026-11-01T22:00:00.000Z");
  });
  it("handles missing stops, service calendars and malformed times as unavailable",()=>{
    expect(calculateDepartures(table(),["missing"]).hasRecords).toBe(false);expect(calculateDepartures(table({times:[""]}),["s"]).departures).toHaveLength(0);expect(calculateDepartures(table({calendars:[]}),["s"]).departures).toHaveLength(0);
  });
});
