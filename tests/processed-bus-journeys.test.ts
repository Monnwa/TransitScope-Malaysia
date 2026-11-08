import { describe, expect, it } from "vitest";
import { ProcessedBusJourneys, type BusJourneyFeed } from "@/lib/processed-bus-journeys";
import { VehicleProgressHistory } from "@/lib/vehicle-progress-history";
import { adherenceFixture, adherencePoint } from "@/tests/fixtures/adherence";

function setup(){
  const fixture=adherenceFixture(),history=new VehicleProgressHistory(),store=new ProcessedBusJourneys(history);
  const feed:BusJourneyFeed={timetable:fixture.table,tripPaths:new Map([["t",fixture.path]]),progressPaths:new Map([["t",fixture.path]]),tripShapeDistances:new Map()};
  const records=(distance:number,timestamp:number)=>["A","B"].map(id=>({...fixture.bus,id,position:adherencePoint(distance),reportedAt:new Date(timestamp).toISOString(),observation:{...fixture.bus.observation,positionTimestamp:new Date(timestamp).toISOString()}}));
  const process=(distance:number,timestamp:number)=>store.process("rapid-bus-kl",history.ingest("rapid-bus-kl",records(distance,timestamp),timestamp),feed,timestamp);
  return {...fixture,history,store,feed,records,process};
}
describe("feed-owned bus journey processing",()=>{
  it("processes multiple unselected buses and records passage classifications before any UI exists",()=>{
    const f=setup();for(const fix of f.fixes)f.process((fix.position[1]-adherencePoint(0)[1])*111195.08*Math.cos(3.14*Math.PI/180),fix.timestamp);
    const result=f.process(1100,f.now);
    expect(result).toHaveLength(2);
    for(const entry of result){expect(entry.state).toBe("READY");expect(entry.journey!.stops.map(stop=>stop.adherence?.status)).toEqual(["STATUS_UNKNOWN","DELAYED","ON_TIME","EARLY","STATUS_UNKNOWN"]);expect(f.history.get(entry.source,entry.vehicleId)?.previous).toBe(entry.journey!.tracking);}
    expect(result.flatMap(entry=>entry.journey!.stops).filter(stop=>stop.adherence?.result)).toHaveLength(6);
  });
  it("reuses unchanged vehicles and reprocesses only changed GPS observations",()=>{
    const f=setup(),initial=f.process(900,f.now-30000);
    const same=f.store.process("rapid-bus-kl",f.records(900,f.now-30000),f.feed,f.now-20000);
    expect(same[0]).toBe(initial[0]);expect(same[1]).toBe(initial[1]);
    const records=[f.records(1100,f.now)[0],f.records(900,f.now-30000)[1]];
    const updated=f.store.process("rapid-bus-kl",f.history.ingest("rapid-bus-kl",records,f.now),f.feed,f.now);
    expect(updated[0]).not.toBe(initial[0]);expect(updated[1]).toBe(initial[1]);
  });
  it("preserves completed results on failures without manufacturing new classifications",()=>{
    const f=setup();for(const fix of f.fixes)f.process((fix.position[1]-adherencePoint(0)[1])*111195.08*Math.cos(3.14*Math.PI/180),fix.timestamp);
    const result=f.process(1100,f.now),failed=f.store.unavailable("rapid-bus-kl",f.records(1100,f.now),f.now+30000);
    expect(failed[0].state).toBe("DATA_UNAVAILABLE");expect(failed[0].journey).toBe(result[0].journey);
    const stale=f.store.process("rapid-bus-kl",f.history.ingest("rapid-bus-kl",f.records(1100,f.now),f.now+150000),f.feed,f.now+150000);
    expect(stale[0].journey!.stops.every(stop=>stop.adherence?.status==="STATUS_UNKNOWN")).toBe(true);
    expect(stale[0].journey!.stops.filter(stop=>stop.adherence?.lastValid)).toHaveLength(3);
  });
  it("keeps insufficient evidence unknown and distinguishes no match from missing static data",()=>{
    const f=setup(),single=f.process(1100,f.now);
    expect(single[0].state).toBe("READY");expect(single[0].journey!.stops.every(stop=>stop.adherence?.status==="STATUS_UNKNOWN")).toBe(true);
    const unmatched=f.store.process("rapid-bus-kl",[{...f.bus,tripId:"absent"}],f.feed,f.now);
    expect(unmatched[0].state).toBe("NO_MATCH");
    expect(f.store.unavailable("rapid-bus-penang",[{...f.bus,feedId:"rapid-bus-penang"}],f.now)[0]).toMatchObject({state:"DATA_UNAVAILABLE",journey:null});
  });
  it("isolates source identities, prunes vanished vehicles and expires retained failure results",()=>{
    const f=setup();f.process(900,f.now-30000);
    expect(f.store.unavailable("rapid-bus-penang",f.records(1100,f.now),f.now).every(entry=>entry.journey===null)).toBe(true);
    f.store.process("rapid-bus-kl",[],f.feed,f.now);
    expect(f.store.unavailable("rapid-bus-kl",f.records(1100,f.now),f.now).every(entry=>entry.journey===null)).toBe(true);
    f.process(1100,f.now);
    expect(f.store.unavailable("rapid-bus-kl",f.records(1100,f.now),f.now+600001).every(entry=>entry.journey===null)).toBe(true);
  });
});
