import { expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { transitResponse } from "@/lib/transit-response";
import type { TransitApiResponse } from "@/lib/transit-data";
import { adherenceFixture } from "@/tests/fixtures/adherence";

it("losslessly compresses complete shared journey results for browser transport",async()=>{
  const f=adherenceFixture(),payload:TransitApiResponse={records:[f.bus],busJourneys:[{source:"rapid-bus-kl",vehicleId:f.bus.id,state:"READY",journey:f.journey}],alerts:[],feeds:[],fetchedAt:new Date(f.now).toISOString(),demo:false};
  const response=await transitResponse(payload,"br, gzip;q=0.8, deflate"),body=Buffer.from(await response.arrayBuffer());
  expect(response.headers.get("content-encoding")).toBe("gzip");expect(response.headers.get("cache-control")).toBe("no-store");expect(response.headers.get("vary")).toBe("Accept-Encoding");
  expect(JSON.parse(gunzipSync(body).toString())).toEqual(payload);expect(body.byteLength).toBeLessThan(JSON.stringify(payload).length/2);
});
it.each([null,"br","gzip;q=0","gzip;q=0.000, deflate"])("retains plain JSON when gzip is not accepted: %s",async encoding=>{
  const payload={records:[],feeds:[],alerts:[],fetchedAt:"fixture",demo:false};const response=await transitResponse(payload,encoding);expect(response.headers.get("content-encoding")).toBeNull();expect(await response.json()).toEqual(payload);
});
it("fails explicitly rather than silently truncating vehicles when a response exceeds its size budget",async()=>{
  const response=await transitResponse({records:[],feeds:[],alerts:[],fetchedAt:"x".repeat(4_000_001),demo:false},null);expect(response.status).toBe(503);expect(await response.json()).toHaveProperty("error");
});
