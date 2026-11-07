import { afterEach,describe,expect,it,vi } from "vitest";
import { calculateBusJourney } from "@/lib/bus-journey";
import { evaluateVehicleProgress } from "@/lib/vehicle-progress";
import { indexShape } from "@/lib/route-projection";
import { VehicleProgressHistory } from "@/lib/vehicle-progress-history";
import * as motion from "@/lib/bus-motion";
import { reviewJourney,reviewNow as now,reviewPath,reviewPoint,reviewRecord } from "./fixtures/bus-motion-review";
afterEach(()=>vi.restoreAllMocks());
describe("GPS history rejection and recovery",()=>{
  it("a future timestamp cannot poison the next valid observation or stored progress",()=>{
    const f=reviewJourney();f.store.save("rapid-bus-kl","review-bus",f.journey.tracking!);
    const future=reviewRecord(400,600);f.store.ingest("rapid-bus-kl",[future],now+1000);
    const invalid=calculateBusJourney(f.table,future,{now:now+1000,paths:f.paths,history:f.store.get("rapid-bus-kl","review-bus")});
    expect(invalid.estimatedNextStop).toBeNull();expect(f.store.get("rapid-bus-kl","review-bus")!.fixes).toEqual([]);
    f.store.save("rapid-bus-kl","review-bus",invalid.tracking!);expect(f.store.get("rapid-bus-kl","review-bus")!.previous).toBeUndefined();
    for(const [m,s]of [[450,30],[600,60],[750,90]]){
      const raw=reviewRecord(m,s),[record]=f.store.ingest("rapid-bus-kl",[raw],now+s*1000);expect(record.observation?.positionTimestamp).toBe(raw.observation?.positionTimestamp);
      const next=calculateBusJourney(f.table,record,{now:now+s*1000,paths:f.paths,history:f.store.get("rapid-bus-kl","review-bus")});
      if(s===30){expect(next.tracking?.source).toBe("APPROXIMATE");expect(next.estimatedNextStop).toBeNull();}
      if(s===90)expect(next.estimatedNextStop?.status).toBe("ESTIMATED");
      if(next.tracking)f.store.save("rapid-bus-kl","review-bus",next.tracking);
    }
  });
  it("invalid/stale clocks never enter history, and an older packet cannot rewind the latest valid fix",()=>{
    const store=new VehicleProgressHistory();for(const record of [reviewRecord(0,-121),reviewRecord(0,0,{observation:{}})]){store.ingest("feed",[record],now);expect(store.get("feed","review-bus")!.fixes).toEqual([]);}
    store.ingest("feed",[reviewRecord(300)],now);const token=store.get("feed","review-bus")!.token;
    const [kept]=store.ingest("feed",[reviewRecord(0,-30)],now+1000);expect(kept.position).toEqual(reviewPoint(300));expect(store.get("feed","review-bus")!.token).toBe(token);
    expect(store.get("feed","review-bus")!.fixes).toHaveLength(1);
  });
  it("conflicting coordinates at the same timestamp cannot add speed evidence or replace the measured point",()=>{
    const f=reviewJourney(),[kept]=f.store.ingest("rapid-bus-kl",[reviewRecord(1400)],now+1000);
    expect(kept.position).toEqual(reviewPoint(300));expect(f.store.get("rapid-bus-kl","review-bus")!.fixes).toHaveLength(3);
  });
  it("does not save another vehicle's progress in this vehicle's history",()=>{
    const f=reviewJourney();f.store.save("rapid-bus-kl","review-bus",{...f.journey.tracking!,vehicleId:"other"});expect(f.store.get("rapid-bus-kl","review-bus")!.previous).toBeUndefined();
  });
});
describe("ETA context isolation and independence",()=>{
  it("uses the original service date and GPS intervals across Malaysia midnight",()=>{
    const {journey}=reviewJourney();expect(journey.match.status).toBe("MATCHED");expect(journey.vehicleDeparture?.serviceDate).toBe("2026-11-07");
    expect(journey.estimatedNextStop?.arrivalAt).toBeCloseTo(Date.parse("2026-11-08T00:02:30+08:00"),-1);
    expect(journey.stops[1].arrival).toBe("2026-11-07T16:05:00.000Z");expect(journey.stops[0].adherence?.status).toBe("ON_TIME");
  });
  it("cannot reuse motion after vehicle, trip, route, service date or direction metadata changes",()=>{
    const {journey}=reviewJourney(),original=journey.tracking!,shape=indexShape(reviewPath)!;
    for(const patch of [{vehicleId:"other"},{tripId:"other"},{routeId:"other"},{serviceDate:"2026-11-08"},{directionId:"1"}]){
      // Even a caller reusing the same opaque key must not reuse ETA samples.
      const context={...original,...patch,stops:original.stopProjections},fix={timestamp:now+30000,position:reviewPoint(450),bearing:90,speed:5,accuracyM:null};
      const next=evaluateVehicleProgress(context,shape,fix,now+30000,{token:original.historyToken,fixes:[],previous:original});
      expect(next.historicalSpeed).toBeNull();expect(motion.estimatedBusArrival(next,now+30000)).toBeNull();
      expect(motion.estimatedBusArrival({...original,...patch},now)).toBeNull();
      const duplicate=evaluateVehicleProgress(context,shape,{...fix,timestamp:now,position:reviewPoint(300)},now,{token:original.historyToken,fixes:[],previous:original});
      expect(duplicate.historicalSpeed).toBeNull();expect(motion.estimatedBusArrival(duplicate,now)).toBeNull();
    }
  });
  it("direction switches start a new history and require fresh observations in the correct trip shape",()=>{
    const f=reviewJourney(),oldToken=f.store.get("rapid-bus-kl","review-bus")!.token;
    for(const [m,s]of [[1200,30],[1050,60],[900,90]]){
      const raw=reviewRecord(m,s,{tripId:"back",bearing:270,observation:{positionTimestamp:new Date(now+s*1000).toISOString(),tripStartDate:"20261107",directionId:"1"}});
      const [record]=f.store.ingest("rapid-bus-kl",[raw],now+s*1000),history=f.store.get("rapid-bus-kl","review-bus")!;
      expect(history.token).not.toBe(oldToken);const result=calculateBusJourney(f.table,record,{now:now+s*1000,paths:f.paths,history});
      if(s===30){expect(history.fixes).toHaveLength(1);expect(result.estimatedNextStop).toBeNull();}
      if(s===90){expect(result.tracking?.directionId).toBe("1");expect(result.estimatedNextStop?.stopName).toBe("Reverse fixture 1");}
      if(result.tracking)f.store.save("rapid-bus-kl","review-bus",result.tracking);
    }
  });
  it("disabling historical speed or ETA cannot change progress, stop classifications, schedules or adherence",()=>{
    const f=reviewJourney(),before=structuredClone(f.journey),options={now,paths:f.paths,history:f.store.get("rapid-bus-kl","review-bus")};
    const independent=(j:typeof before)=>({progress:j.progress,stops:j.stops,delay:j.delay,passages:j.tracking?.passages,states:j.tracking?.stopStates,distance:j.tracking?.distanceM,source:j.tracking?.source});
    expect(before.estimatedNextStop).not.toBeNull();vi.spyOn(motion,"historicalBusSpeed").mockReturnValue(null);
    const noSpeed=calculateBusJourney(f.table,reviewRecord(),options);expect(noSpeed.estimatedNextStop).toBeNull();expect(independent(noSpeed)).toEqual(independent(before));
    vi.restoreAllMocks();vi.spyOn(motion,"estimatedBusArrival").mockReturnValue(null);
    const noEta=calculateBusJourney(f.table,reviewRecord(),options);expect(independent(noEta)).toEqual(independent(before));expect(f.journey).toEqual(before);
  });
  it("uses one captured clock for matching, progress, adherence and prediction boundaries",()=>{
    const f=reviewJourney();let calls=0;vi.spyOn(Date,"now").mockImplementation(()=>now+calls++);
    const result=calculateBusJourney(f.table,reviewRecord(),{paths:f.paths,history:f.store.get("rapid-bus-kl","review-bus")});
    expect(calls).toBe(1);expect(result.retrievedAt).toBe(new Date(now).toISOString());expect(result.estimatedNextStop).not.toBeNull();
  });
  it("a malformed measurement cannot be silently dropped to create sufficient ETA history",()=>{
    const sample=(timestamp:number,distanceM:number)=>({timestamp,distanceM,rawDistanceM:distanceM,offsetM:0,accuracyM:null});
    expect(motion.historicalBusSpeed([sample(now-60000,0),sample(now-30000,150),sample(now,300),sample(NaN,450)],now)).toBeNull();
  });
  it("stopping and congestion withdraw ETA without changing the existing next-stop classification",()=>{
    const f=reviewJourney(),original=f.journey.tracking!,shape=indexShape(reviewPath)!,context={...original,stops:original.stopProjections};
    for(const metres of [300,320]){
      const next=evaluateVehicleProgress(context,shape,{timestamp:now+30000,position:reviewPoint(metres),bearing:90,speed:0,accuracyM:null},now+30000,{token:original.historyToken,fixes:[],previous:original});
      expect(motion.estimatedBusArrival(next,now+30000)).toBeNull();expect(next.stopStates).toEqual(original.stopStates);expect(next.nextStopSequence).toBe(original.nextStopSequence);
    }
  });
  it("a long observation gap does not bridge old speed samples into an ETA",()=>{
    const f=reviewJourney(),original=f.journey.tracking!,shape=indexShape(reviewPath)!,next=evaluateVehicleProgress({...original,stops:original.stopProjections},shape,{timestamp:now+70000,position:reviewPoint(650),bearing:90,speed:5,accuracyM:null},now+70000,{token:original.historyToken,fixes:[],previous:original});
    expect(next.historicalSpeed).toBeNull();expect(motion.estimatedBusArrival(next,now+70000)).toBeNull();
  });
});
