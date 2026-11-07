import { afterEach,expect,it,vi } from "vitest";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { gtfsTimestamp,validGpsPosition } from "@/lib/vehicle-observation";
const stamp=Date.parse("2026-11-07T15:00:00Z");
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();vi.resetModules();});
async function records(options:{point?:[number,number];timestamp?:number;headerTimestamp?:number}={}){
  vi.resetModules();vi.useFakeTimers();vi.setSystemTime(stamp);
  const bytes=GtfsRealtimeBindings.transit_realtime.FeedMessage.encode({header:{gtfsRealtimeVersion:"2.0",timestamp:options.headerTimestamp??stamp/1000},entity:[{id:"fixture",vehicle:{vehicle:{id:"fixture"},position:{latitude:options.point?.[0]??3.14,longitude:options.point?.[1]??101.69},...(options.timestamp!==undefined?{timestamp:options.timestamp}:{})}}]}).finish();
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(new Uint8Array(bytes).buffer,{status:200})));
  const {getOfficialTransit}=await import("@/lib/official-transit");return getOfficialTransit();
}
it("does not use the feed publication timestamp as the vehicle measurement time",async()=>{
  const result=await records();expect(result.records).toHaveLength(4);expect(result.records.every(record=>record.reportedAt===null&&record.observation?.positionTimestamp===undefined)).toBe(true);expect(result.feeds[0].sourceTimestamp).toBe(new Date(stamp).toISOString());
});
it("retains a valid own GPS timestamp independently of feed publication time",async()=>{
  const result=await records({timestamp:stamp/1000-30});expect(result.records[0].reportedAt).toBe(new Date(stamp-30000).toISOString());
});
it("drops the observed zero-position sentinel from official vehicle markers",async()=>{
  const result=await records({point:[0,0],timestamp:stamp/1000});expect(result.records).toEqual([]);expect(result.feeds.every(feed=>feed.status==="healthy")).toBe(true);
});
it("malformed measurement times cannot crash a whole otherwise available vehicle feed",async()=>{
  const result=await records({timestamp:8640000000001});expect(result.records).toHaveLength(4);expect(result.records.every(record=>record.reportedAt===null)).toBe(true);
});
it.each([[91,101.69],[-91,101.69],[3.14,181],[3.14,-181],[NaN,101.69],[3.14,Infinity]] as [number,number][])("rejects invalid latitude/longitude (%s,%s) before plotting a vehicle",async(lat,lon)=>{
  expect(validGpsPosition([lat,lon])).toBe(false);const result=await records({point:[lat,lon],timestamp:stamp/1000});expect(result.records).toEqual([]);
});
it("an invalid publication clock cannot hide valid vehicle measurements or impersonate their time",async()=>{
  const result=await records({timestamp:stamp/1000-30,headerTimestamp:8640000000001});expect(result.records).toHaveLength(4);expect(result.records[0].reportedAt).toBe(new Date(stamp-30000).toISOString());expect(result.feeds[0].sourceTimestamp).toBeNull();
});
it.each([NaN,Infinity,-1,0,1.5,8640000000001])("rejects a malformed protobuf timestamp: %s",value=>expect(gtfsTimestamp(value)).toBeUndefined());
