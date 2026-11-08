import { expect, it } from "vitest";
import { mergeProcessedTransit } from "@/lib/bus-journey-store";
import { adherenceFixture } from "@/tests/fixtures/adherence";
import type { TransitApiResponse } from "@/lib/transit-data";

function fixture(){const f=adherenceFixture();const payload:TransitApiResponse={records:[f.bus],busJourneys:[{source:"rapid-bus-kl",vehicleId:f.bus.id,state:"READY",journey:f.journey}],feeds:[{id:"rapid-bus-kl",label:"Fixture",status:"healthy",lastSuccessAt:null,sourceTimestamp:null,message:null,records:1}],alerts:[],fetchedAt:new Date(f.now).toISOString(),demo:false};return {f,payload};}
it("retains evidence for every bus across a server cold start without any mounted panel",()=>{
  const {payload}=fixture(),fresh=adherenceFixture({onlyOneFix:true}).journey;
  const merged=mergeProcessedTransit(payload,{...payload,busJourneys:[{...payload.busJourneys![0],journey:fresh}]});
  expect(merged.busJourneys![0].journey!.stops.filter(stop=>stop.adherence?.lastValid)).toHaveLength(3);
  expect(merged.busJourneys![0].journey!.stops.every(stop=>stop.adherence?.status==="STATUS_UNKNOWN")).toBe(true);
});
it("retains absent vehicles and completed results when an upstream feed fails on a cold instance",()=>{
  const {payload}=fixture(),failed=mergeProcessedTransit(payload,{...payload,records:[],busJourneys:[],feeds:payload.feeds.map(feed=>({...feed,status:"unavailable"}))});
  expect(failed.records).toEqual(payload.records);expect(failed.busJourneys![0]).toEqual({...payload.busJourneys![0],state:"DATA_UNAVAILABLE"});
  const removed=mergeProcessedTransit(payload,{...payload,records:[],busJourneys:[]});expect(removed.records).toEqual([]);expect(removed.busJourneys).toEqual([]);
});
it("does not transfer classifications to another run, source or demo mode",()=>{
  const {payload}=fixture(),changed=structuredClone(payload);changed.busJourneys![0].journey!.selectedDeparture!.key="different-run";changed.busJourneys![0].journey!.stops.forEach(stop=>{if(stop.adherence){stop.adherence.result=null;stop.adherence.lastValid=null;stop.adherence.status="STATUS_UNKNOWN";}});
  expect(mergeProcessedTransit(payload,changed).busJourneys![0].journey!.stops.every(stop=>!stop.adherence?.result)).toBe(true);
  const demo={...payload,demo:true,records:[],busJourneys:[]};expect(mergeProcessedTransit(payload,demo)).toBe(demo);
});
