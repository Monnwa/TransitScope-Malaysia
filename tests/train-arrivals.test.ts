import { describe, expect, it } from "vitest";
import { buildTimetable, calculateDepartures } from "@/lib/scheduled-departures";
import { calculateTrainArrivals, frequencyKey } from "@/lib/train-arrivals";
import { arrivalClock, arrivalCountdown } from "@/lib/departure-board";
import type { Mode } from "@/lib/transit-data";

type Row = Record<string,string>;
const calendar = {service_id:"daily",start_date:"20261107",end_date:"20261107",saturday:"1"};
const time = (clock:string, date="2026-11-07") => Date.parse(`${date}T${clock}+08:00`);
const iso = (clock:string, date="2026-11-07") => new Date(time(clock,date)).toISOString();
function fixture(options:{route?:string;mode?:Mode;windows?:Row[];times?:Row[];calendars?:Row[];exceptions?:Row[];trips?:Row[]}={}) {
  return buildTimetable({
    stopTimes:options.times??[
      {trip_id:"t",stop_id:"origin",stop_sequence:"1",arrival_time:"05:59:42",departure_time:"06:00:00"},
      {trip_id:"t",stop_id:"s",stop_sequence:"2",arrival_time:"06:12:00",departure_time:"06:12:30"},
      {trip_id:"t",stop_id:"end",stop_sequence:"3",arrival_time:"06:30:00",departure_time:"06:30:00"}],
    trips:options.trips??[{trip_id:"t",route_id:options.route??"KGL",service_id:"daily",trip_headsign:"Fixture terminus",direction_id:"0"}],
    routes:[{route_id:options.route??"KGL",route_long_name:`Fixture ${options.route??"KGL"}`}],
    stops:[{stop_id:"s",platform_code:"2"}],calendars:options.calendars??[calendar],exceptions:options.exceptions??[],
    frequencies:options.windows??[{trip_id:"t",start_time:"06:00:00",end_time:"07:00:00",headway_secs:"300"}],
    source:"https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl",mode:()=>options.mode??"MRT"});
}
describe("official train arrivals",()=>{
  for(const [route,mode] of [["KGL","MRT"],["PYL","MRT"],["KJ","LRT"],["AG","LRT"],["PH","LRT"],["MR","Monorail"]] as const) {
    it(`${route}: uses the first departure anchor and selected arrival offset`,()=>{
      const result=calculateTrainArrivals(fixture({route,mode}),["s"],time("06:13:00"));
      expect(result.trainArrivals[0]).toMatchObject({routeId:route,mode,arrivalTime:iso("06:17:00"),classification:"ESTIMATED",basis:"PUBLISHED_FREQUENCY_ANCHOR",direction:"0",platform:"2"});
      expect(result.trainArrivals[1].arrivalTime).toBe(iso("06:22:00"));
      const frequency=calculateDepartures(fixture({route,mode}),["s"],time("06:13:00")).frequencies[0];
      expect(result.arrivalFrequencyCoverage).toContain(frequencyKey(frequency.source,frequency.tripId,frequency.platform,frequency.start,frequency.end));
    });
  }
  it("exact frequency slots are scheduled; omitted/zero exact_times remain estimated",()=>{
    for(const exact of ["1","0",""]) {
      const t=fixture({windows:[{trip_id:"t",start_time:"06:00:00",end_time:"07:00:00",headway_secs:"300",exact_times:exact}]});
      expect(calculateTrainArrivals(t,["s"],time("06:13:00")).trainArrivals[0].classification).toBe(exact==="1"?"SCHEDULED":"ESTIMATED");
    }
  });
  it("exact stop_times use arrival rather than departure; interpolated stops remain estimated",()=>{
    const t=fixture({windows:[]});
    expect(calculateTrainArrivals(t,["s"],time("06:00:00")).trainArrivals[0]).toMatchObject({arrivalTime:iso("06:12:00"),classification:"SCHEDULED"});
    t.arrivalStops.get("s")![0].timepoint="0";
    expect(calculateTrainArrivals(t,["s"],time("06:00:00")).trainArrivals[0].classification).toBe("ESTIMATED");
  });
  it("includes the first slot, excludes the shifted end and respects independent headways",()=>{
    const t=fixture({windows:[{trip_id:"t",start_time:"06:00:00",end_time:"06:10:00",headway_secs:"300"},{trip_id:"t",start_time:"06:10:00",end_time:"06:20:00",headway_secs:"180"}]});
    const result=calculateTrainArrivals(t,["s"],time("06:12:00"));
    expect(result.trainArrivals.map(r=>r.arrivalTime)).toEqual(["06:12:00","06:17:00","06:22:00","06:25:00","06:28:00","06:31:00"].map(clock=>iso(clock)));
    expect(calculateTrainArrivals(t,["s"],time("06:32:00")).trainArrivals).toEqual([]);
  });
  it("keeps directions independent, chronologically sorted, and deduplicates duplicate trips/stops",()=>{
    const t=fixture();const original=t.arrivalStops.get("s")![0];
    t.trips.set("back",{...t.trips.get("t")!,trip_id:"back",direction_id:"1",trip_headsign:"Other terminus"});
    t.origins.set("back",{...t.origins.get("t")!,trip_id:"back"});t.frequencies.set("back",t.frequencies.get("t")!);
    t.arrivalStops.get("s")!.push(original,{...original,trip_id:"back",arrival_time:"06:14:00",departure_time:"06:14:30"});
    const result=calculateTrainArrivals(t,["s","s"],time("06:12:00")).trainArrivals;
    expect(result).toHaveLength(10);expect(result.slice(0,3).map(r=>[r.direction,r.arrivalTime])).toEqual([["0",iso("06:12:00")],["1",iso("06:14:00")],["0",iso("06:17:00")]]);
    expect(new Set(result.map(r=>`${r.direction}:${r.arrivalTime}`)).size).toBe(10);
  });
  it("honours removed/added service dates and inactive weekdays",()=>{
    expect(calculateTrainArrivals(fixture({exceptions:[{service_id:"daily",date:"20261107",exception_type:"2"}]}),["s"],time("06:00:00")).trainArrivals).toEqual([]);
    expect(calculateTrainArrivals(fixture({calendars:[],exceptions:[{service_id:"daily",date:"20261107",exception_type:"1"}]}),["s"],time("06:00:00")).trainArrivals.length).toBeGreaterThan(0);
    expect(calculateTrainArrivals(fixture({calendars:[{...calendar,saturday:"0"}]}),["s"],time("06:00:00")).activeToday).toBe(false);
  });
  it("uses previous service dates for >24h windows without extending operating hours",()=>{
    const t=fixture({windows:[{trip_id:"t",start_time:"23:50:00",end_time:"25:00:00",headway_secs:"600"}]});
    const result=calculateTrainArrivals(t,["s"],time("00:05:00","2026-11-08"));
    expect(result.trainArrivals[0]).toMatchObject({serviceDate:"2026-11-07",arrivalTime:iso("00:12:00","2026-11-08")});
    expect(result.trainArrivals.at(-1)!.arrivalTime).toBe(iso("01:02:00","2026-11-08"));
    expect(calculateTrainArrivals(t,["s"],time("01:12:00","2026-11-08")).noMoreToday).toBe(true);
  });
  it("reports no more today and excludes passed trains",()=>{
    const result=calculateTrainArrivals(fixture(),["s"],time("08:00:00"));
    expect(result.trainArrivals).toEqual([]);expect(result.noMoreToday).toBe(true);expect(result.activeToday).toBe(true);
  });
  it("retains terminal arrivals even though onward departures exclude them",()=>{
    const t=fixture();expect(calculateTrainArrivals(t,["end"],time("06:30:00")).trainArrivals[0].arrivalTime).toBe(iso("06:30:00"));
    expect(calculateDepartures(t,["end"],time("06:30:00")).departures).toEqual([]);
  });
  it("does not substitute a later stop's departure for a missing first departure",()=>{
    const t=fixture();t.origins.get("t")!.departure_time="";
    const result=calculateTrainArrivals(t,["s"],time("06:00:00"));expect(result.trainArrivals).toEqual([]);expect(result.arrivalFrequencyCoverage).toEqual([]);
  });
  it("rejects conflicting origins and invalid/overlapping frequency windows",()=>{
    const bad:Row[]=[{headway_secs:"0"},{headway_secs:"bad"},{exact_times:"2"},{start_time:"bad"},{end_time:"05:00:00"}];
    for(const values of bad)expect(calculateTrainArrivals(fixture({windows:[{trip_id:"t",start_time:"06:00:00",end_time:"07:00:00",headway_secs:"300",...values}]}),["s"],time("06:00:00")).trainArrivals).toEqual([]);
    const t=fixture();t.frequencies.get("t")!.push({...t.frequencies.get("t")![0],start_time:"06:30:00"});
    expect(calculateTrainArrivals(t,["s"],time("06:00:00")).trainArrivals).toEqual([]);
    const origin=fixture();origin.originConflicts.add("t");expect(calculateTrainArrivals(origin,["s"],time("06:00:00")).trainArrivals).toEqual([]);
  });
  it("deduplicates identical frequency rows but rejects impossible offsets",()=>{
    const t=fixture();t.frequencies.get("t")!.push(t.frequencies.get("t")![0]);
    expect(calculateTrainArrivals(t,["s"],time("06:00:00")).trainArrivals).toHaveLength(10);
    t.arrivalStops.get("s")![0].arrival_time="05:00:00";
    expect(calculateTrainArrivals(t,["s"],time("06:00:00")).trainArrivals).toEqual([]);
  });
  it("does not alter bus or KTM departure calculations",()=>{
    for(const mode of ["Bus","KTM"] as const){const t=fixture({mode,windows:[]});expect(calculateTrainArrivals(t,["s"],time("06:00:00")).trainArrivals).toEqual([]);expect(calculateDepartures(t,["s"],time("06:00:00")).departures[0].scheduledDeparture).toBe(iso("06:12:30"));}
  });
  it("does not interpret BRT category as a train despite legacy route_type=0 mapping",()=>{
    const t=fixture();t.routes.get("KGL")!.category="BRT";
    expect(calculateTrainArrivals(t,["s"],time("06:00:00")).trainArrivals).toEqual([]);
  });
  it("formats 12-hour Malaysia arrivals and advancing minute countdowns",()=>{
    expect(arrivalClock(iso("14:17:00"))).toMatch(/2:17 PM/);expect(arrivalClock(iso("00:12:00"))).toMatch(/12:12 AM/);
    expect(arrivalCountdown(time("06:17:00"),time("06:13:00"))).toBe("4 min");expect(arrivalCountdown(time("06:17:00"),time("06:14:00"))).toBe("3 min");expect(arrivalCountdown(time("06:17:00"),time("06:16:30"))).toBe("<1 min");expect(arrivalCountdown(time("06:17:00"),time("06:18:00"))).toBeNull();
  });
});
