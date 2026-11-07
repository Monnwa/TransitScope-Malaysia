import { afterEach,expect,it,vi } from "vitest";
vi.mock("@/lib/official-transit",()=>({getRailStaticFeed:vi.fn()}));
import { getRailStaticFeed } from "@/lib/official-transit";
import { GET } from "@/app/api/train-positions/route";
import { trainFixture,trainTime } from "./fixtures/train-positions";
afterEach(()=>{vi.useRealTimers();vi.resetAllMocks();});
it("uses shared official static data and returns only explicitly estimated models",async()=>{
  vi.useFakeTimers();vi.setSystemTime(trainTime());const f=trainFixture();vi.mocked(getRailStaticFeed).mockResolvedValue({timetable:f.table,progressPaths:f.paths,tripShapeDistances:new Map()} as Awaited<ReturnType<typeof getRailStaticFeed>>);
  const response=await GET(),p=await response.json();expect(getRailStaticFeed).toHaveBeenCalledWith("rapid-rail-kl");expect(response.headers.get("cache-control")).toContain("s-maxage=15");expect(p.runs).toHaveLength(1);expect(p.dataMode).toBe("ESTIMATED");expect(p.runs[0].dataMode).toBe("ESTIMATED");
});
it("source failure returns an explicit unavailable state without fallback trains",async()=>{
  vi.mocked(getRailStaticFeed).mockRejectedValue(new Error("Fixture outage"));const response=await GET(),p=await response.json();expect(response.status).toBe(503);expect(response.headers.get("cache-control")).toBe("no-store");expect(p.error).toContain("unavailable");expect(p.runs).toBeUndefined();
});
