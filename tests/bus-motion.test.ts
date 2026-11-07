import { describe,expect,it } from "vitest";
import { historicalBusSpeed,estimatedBusArrival,estimatedBusArrivalLabel,type SpeedSample } from "@/lib/bus-motion";
import { indexShape,projectStops,type GeoPoint } from "@/lib/route-projection";
import { evaluateVehicleProgress,type GpsFix } from "@/lib/vehicle-progress";
import { currentTracking } from "@/lib/bus-progress";
import { validGpsPosition } from "@/lib/vehicle-observation";
import { gpsFix } from "@/lib/vehicle-progress-history";
import { calculateBusJourney } from "@/lib/bus-journey";
import { adherenceFixture } from "./fixtures/adherence";
const now=Date.parse("2026-11-07T15:00:00Z"),p=(metres:number,north=0):GeoPoint=>[3.14+north/111195.08,101.69+metres/(111195.08*Math.cos(3.14*Math.PI/180))];
const shape=indexShape([p(0),p(300),p(600),p(900),p(1200),p(1800),p(2400),p(3000)])!;
const stops=projectStops(shape,[100,900,1500].map((m,i)=>({id:`S${i}`,name:`Fixture stop ${i}`,sequence:i+1,position:p(m),shapeDistance:null})));
const context={key:"fixture-run",historyToken:"fixture-session",vehicleId:"bus",tripId:"trip",shapeId:"shape",serviceDate:"2026-11-07",stops};
const fix=(distance:number,ago:number):GpsFix=>({timestamp:now-ago*1000,position:p(distance),bearing:90,speed:99,accuracyM:null});
const tracking=()=>evaluateVehicleProgress(context,shape,fix(400,0),now,{token:context.historyToken,fixes:[fix(100,60),fix(250,30)]});
const samples=():SpeedSample[]=>[100,250,400].map((distanceM,i)=>({timestamp:now-(2-i)*30000,distanceM,rawDistanceM:distanceM,offsetM:3,accuracyM:null}));
describe("bounded historical bus motion",()=>{
  it("uses three timestamped accepted positions, not supplied instantaneous speed",()=>{
    const t=tracking();expect(t.source).toBe("GPS_INFERRED");expect(t.historicalSpeed).toMatchObject({basis:"ACCEPTED_GPS_HISTORY",observationCount:3,spanMs:60000});expect(t.historicalSpeed!.speedMps).toBeCloseTo(5,3);expect(t.historicalSpeed!.speedMps).not.toBe(99);
  });
  it("never predicts from one observation or only a two-point crossing",()=>{
    for(const fixes of [[],[fix(250,30)]]){const t=evaluateVehicleProgress(context,shape,fix(400,0),now,{token:context.historyToken,fixes});expect(t.historicalSpeed).toBeNull();expect(estimatedBusArrival(t,now)).toBeNull();expect(t.stopStates.map(s=>s.state)).not.toContain("CURRENT");}
  });
  it("requires distinct chronological measurements, adequate duration and distance",()=>{
    for(const values of [samples().slice(1),[samples()[0],samples()[0],samples()[2]],samples().reverse(),samples().map((s,i)=>({...s,timestamp:now-(2-i)*10000})),samples().map((s,i)=>({...s,distanceM:i*10,rawDistanceM:i*10}))])expect(historicalBusSpeed(values,now)).toBeNull();
  });
  it("withholds speed for stationary, reversing, clamped, inaccurate or inconsistent motion",()=>{
    const patches=[(s:SpeedSample[])=>s.map(v=>({...v,distanceM:100,rawDistanceM:100})),(s:SpeedSample[])=>s.map((v,i)=>({...v,distanceM:400-i*150,rawDistanceM:400-i*150})),(s:SpeedSample[])=>s.map(v=>({...v,rawDistanceM:v.distanceM-20})),(s:SpeedSample[])=>s.map(v=>({...v,accuracyM:80})),(s:SpeedSample[])=>s.map(v=>({...v,offsetM:26})),(s:SpeedSample[])=>s.map((v,i)=>({...v,distanceM:[0,60,600][i],rawDistanceM:[0,60,600][i]}))];
    for(const mutate of patches)expect(historicalBusSpeed(mutate(samples()),now)).toBeNull();
  });
  it("rejects future, expired, overly sparse and impossible speed samples",()=>{
    expect(historicalBusSpeed(samples(),now+121000)).toBeNull();expect(historicalBusSpeed(samples(),now-1000)).toBeNull();
    expect(historicalBusSpeed(samples().map((s,i)=>({...s,timestamp:now-(2-i)*61000})),now)).toBeNull();
    expect(historicalBusSpeed(samples().map((s,i)=>({...s,distanceM:i*1000,rawDistanceM:i*1000})),now)).toBeNull();
  });
  it("uses a bounded recent window without mutating measurement samples",()=>{
    const values=[{...samples()[0],timestamp:now-200000},...samples()],before=JSON.stringify(values),result=historicalBusSpeed(values,now);expect(result?.observationCount).toBe(3);expect(JSON.stringify(values)).toBe(before);
  });
  it("retains speed samples across validated updates, but duplicates and animation cannot add evidence",()=>{
    const first=evaluateVehicleProgress(context,shape,fix(250,30),now-30000,{token:context.historyToken,fixes:[fix(100,60)]});
    const next=evaluateVehicleProgress(context,shape,fix(400,0),now,{token:context.historyToken,fixes:[],previous:first});expect(next.historicalSpeed?.observationCount).toBe(3);
    const duplicate=evaluateVehicleProgress(context,shape,fix(400,0),now+15000,{token:context.historyToken,fixes:[],previous:next});expect(duplicate.historicalSpeed?.observationCount).toBe(3);expect(duplicate.historicalSpeed?.speedMps).toBe(next.historicalSpeed?.speedMps);
  });
  it("clears speed after a jump, direction change, noise clamp or off-route point",()=>{
    for(const update of [fix(380,-30),fix(2800,-5),{...fix(500,-30),position:p(500,200)}, {...fix(500,-30),bearing:270}]){const t=evaluateVehicleProgress(context,shape,update,update.timestamp,{token:context.historyToken,fixes:[],previous:tracking()});expect(t.historicalSpeed??null).toBeNull();expect(estimatedBusArrival(t,update.timestamp)).toBeNull();}
  });
  it("never carries motion evidence into a new trip or observation session",()=>{
    for(const changed of [{...context,key:"new-trip"},{...context,historyToken:"new-session"}]){const t=evaluateVehicleProgress(changed,shape,fix(500,-30),now+30000,{token:changed.historyToken,fixes:[],previous:tracking()});expect(t.historicalSpeed).toBeNull();expect(estimatedBusArrival(t,now+30000)).toBeNull();}
  });
});
describe("separate estimated next-stop arrival",()=>{
  it("uses official next-stop distance and measured-time speed, with an explicitly estimated range",()=>{
    const t=tracking(),before=JSON.stringify(t),eta=estimatedBusArrival(t,now)!;expect(eta).toMatchObject({status:"ESTIMATED",basis:"RECENT_GPS_MOVEMENT",stopId:"S1",sequence:2,measuredAt:now});expect(eta.arrivalAt-now).toBeCloseTo(100000,0);expect(eta.earliestAt).toBeLessThan(eta.arrivalAt);expect(eta.latestAt).toBeGreaterThan(eta.arrivalAt);expect(estimatedBusArrivalLabel(eta,now)).toBe("About 2–3 min");expect(JSON.stringify(t)).toBe(before);
  });
  it("counts down from original measurement time, never rebases an old fix to now",()=>{
    const first=estimatedBusArrival(tracking(),now)!,later=estimatedBusArrival(tracking(),now+30000)!;expect(later.arrivalAt).toBe(first.arrivalAt);expect(estimatedBusArrivalLabel(later,now+30000)).toBe("About 1–2 min");expect(estimatedBusArrival(tracking(),now+45000)).toBeNull();
  });
  it("expires when its oldest required observation leaves the supported history window",()=>{
    const t=evaluateVehicleProgress(context,shape,fix(550,0),now,{token:context.historyToken,fixes:[fix(0,110),fix(275,55)]}),eta=estimatedBusArrival(t,now)!;
    expect(eta.expiresAt).toBe(now+10000);expect(estimatedBusArrival(t,now+10000)).toBeNull();
  });
  it("withdraws ETA when GPS is unavailable, stale, approximate or a run changes",()=>{
    for(const t of [currentTracking(tracking(),now,false),currentTracking(tracking(),now+130000),{...tracking(),source:"APPROXIMATE" as const},{...tracking(),historicalSpeed:null},{...tracking(),vehicleTimestamp:new Date(now+1000).toISOString()}])expect(estimatedBusArrival(t,now)).toBeNull();
  });
  it("does not guess across an ambiguous or missing next stop, terminal or long horizon",()=>{
    const t=tracking();for(const update of [{nextStopSequence:null},{distanceM:900},{distanceM:899.9,vehicleTimestamp:new Date(now-1000).toISOString()},{nextStopSequence:3},{stopProjections:stops.map(s=>({...s,confidence:"LOW" as const}))}])expect(estimatedBusArrival({...t,...update},now)).toBeNull();
  });
  it("does not turn a passed prediction into an actual arrival",()=>{
    const t={...tracking(),distanceM:800};expect(estimatedBusArrival(t,now)?.status).toBe("ESTIMATED");expect(estimatedBusArrival(t,now+20001)).toBeNull();expect(t.stopStates.map(s=>s.state)).not.toContain("CURRENT");
  });
  it("keeps schedules and future previews independent of the GPS prediction",()=>{
    const f=adherenceFixture();f.table.frequencies.set("t",[{trip_id:"t",start_time:"13:40:00",end_time:"16:40:00",headway_secs:"3600",exact_times:"1"}]);f.bus.observation!.tripStartTime="13:40:00";
    const options={now:f.now,paths:new Map([["t",f.path]])},single=calculateBusJourney(f.table,f.bus,options),withHistory=calculateBusJourney(f.table,f.bus,{...options,history:{token:"fixture-session",fixes:f.fixes}});
    expect(withHistory.stops.map(s=>[s.id,s.arrival,s.departure,s.classification])).toEqual(single.stops.map(s=>[s.id,s.arrival,s.departure,s.classification]));
    const next=withHistory.departures.find(d=>d.key!==withHistory.vehicleDeparture?.key)!;expect(next).toBeDefined();const preview=calculateBusJourney(f.table,f.bus,{...options,history:{token:"fixture-session",fixes:f.fixes},departure:next.key});expect(preview.progress.status).toBe("TIMETABLE_PREVIEW");expect(preview.estimatedNextStop).toBeNull();
  });
  it("does not predict from a malformed or mismatched motion descriptor",()=>{
    const t=tracking();for(const patch of [{speedMps:NaN},{speedMps:30},{lowMps:0},{highMps:1},{lastMeasuredAt:now-1},{observationCount:1},{observationCount:3.5},{spanMs:1000},{movementM:10},{relativeDispersion:NaN}])expect(estimatedBusArrival({...t,historicalSpeed:{...t.historicalSpeed!,...patch}},now)).toBeNull();
  });
});
it("rejects the observed (0,0) missing-fix sentinel without inventing a replacement point",()=>{
  expect(validGpsPosition([0,0])).toBe(false);expect(validGpsPosition([3.14,101.69])).toBe(true);expect(validGpsPosition([NaN,101.69])).toBe(false);
  const f=adherenceFixture();expect(gpsFix({...f.bus,position:[0,0]})).toBeNull();expect(gpsFix({...f.bus,observation:{}})).toBeNull();
});
