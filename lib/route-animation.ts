import { bearing, indexShape, pointAtDistance, PROGRESS_LIMITS as L, type GeoPoint, type ShapeIndex } from "@/lib/route-projection";
import type { VehicleProgress } from "@/lib/vehicle-progress";

export type MotionFrame={key:string;vehicleId:string;distanceM:number;targetDistanceM:number;point:GeoPoint;segment:number;heading:number;observedAt:number;playing:boolean;interpolated:boolean;stale:boolean};
export type AnimationClock={now:()=>number;wallNow:()=>number;request:(callback:()=>void)=>number;cancel:(handle:number)=>void};
type Observation={key:string;timestamp:number;distanceM:number;high:boolean};
export type MotionPlan={from:number;to:number;durationMs:number;mode:"ANIMATE"|"DIRECT"|"IGNORE";reason:string};
export function interpolationPlan(previous:Observation|null,next:Observation,rendered:number,reducedMotion=false,passedDistance=-1):MotionPlan {
  const direct=(reason:string):MotionPlan=>({from:next.distanceM,to:next.distanceM,durationMs:0,mode:"DIRECT",reason});
  if(!previous||previous.key!==next.key)return direct("New vehicle, run or route geometry");
  const dt=next.timestamp-previous.timestamp;
  if(dt<=0)return {from:rendered,to:rendered,durationMs:0,mode:"IGNORE",reason:"Duplicate or older GPS observation"};
  if(reducedMotion||!previous.high||!next.high||dt>L.maxAgeMs)return direct("Direct update for motion preference, confidence or observation gap");
  const delta=next.distanceM-previous.distanceM;
  if(delta< -L.positionHysteresisM||delta>L.maximumSpeedMps*dt/1000+L.passedBufferM)return direct("Discontinuous GPS movement");
  const target=Math.max(previous.distanceM,next.distanceM);
  if(delta<=.05)return {from:target,to:target,durationMs:0,mode:"DIRECT",reason:"Stationary or minor backward noise"};
  if(rendered<passedDistance)return direct("Verified passage is beyond the displayed interpolation range");
  // Linear distance interpolation. Catch-up takes longer, never a faster speed
  // than the movement between the two source observations.
  const duration=Math.max(dt,(target-rendered)/delta*dt);
  return {from:rendered,to:target,durationMs:duration,mode:"ANIMATE",reason:"Visual interpolation between verified GPS fixes"};
}
export class RouteAnimator {
  private shape:ShapeIndex|null=null;
  private frame:MotionFrame|null=null;
  private observation:Observation|null=null;
  private plan:MotionPlan|null=null;
  private started=0;
  private handle:number|null=null;
  private listeners=new Set<(frame:MotionFrame|null)=>void>();
  private reduced=false;
  constructor(private clock:AnimationClock){}
  getFrame(){return this.frame;}
  getShape(){return this.shape;}
  subscribe(listener:(frame:MotionFrame|null)=>void){this.listeners.add(listener);listener(this.frame);return()=>{this.listeners.delete(listener);};}
  private emit(){for(const listener of this.listeners)listener(this.frame);}
  private cancel(){if(this.handle!==null)this.clock.cancel(this.handle);this.handle=null;this.plan=null;}
  clear(){this.cancel();this.observation=null;this.shape=null;this.frame=null;this.emit();}
  dispose(){this.clear();this.listeners.clear();}
  setReducedMotion(value:boolean){this.reduced=value;if(value&&this.frame&&this.shape){this.cancel();this.setDistance(this.frame.targetDistanceM,false,false);}}
  update(path:GeoPoint[]|null,tracking:VehicleProgress|undefined,routeId:string|null,reducedMotion=this.reduced){
    this.reduced=reducedMotion;
    if(tracking?.source==="STALE"){
      this.cancel();this.observation=null;
      const shape=path?indexShape(path):null,key=JSON.stringify([tracking.key,tracking.historyToken,routeId,shape?.fingerprint]);
      if(this.frame?.key===key){this.frame={...this.frame,playing:false,stale:true};this.emit();}else this.clear();
      return;
    }
    const shape=path?indexShape(path):null;
    if(!shape||!tracking?.position||tracking.distanceM===null||!tracking.vehicleTimestamp||!["GPS_INFERRED","APPROXIMATE"].includes(tracking.source)){this.clear();return;}
    const timestamp=Date.parse(tracking.vehicleTimestamp),age=this.clock.wallNow()-timestamp;
    if(!Number.isFinite(timestamp)||age>L.maxAgeMs||age< -L.futureToleranceMs){this.cancel();this.observation=null;if(this.frame){this.frame={...this.frame,playing:false,stale:true};this.emit();}return;}
    const key=JSON.stringify([tracking.key,tracking.historyToken,routeId,shape.fingerprint]);
    const next={key,timestamp,distanceM:tracking.distanceM,high:tracking.source==="GPS_INFERRED"&&tracking.confidence==="HIGH"};
    if(this.observation?.key===key&&timestamp<=this.observation.timestamp)return;
    this.advance(); // Sample the current rendered position before replacing a plan.
    if(this.observation?.key===key&&next.high&&this.observation.high&&timestamp-this.observation.timestamp<=L.maxAgeMs&&next.distanceM<=this.observation.distanceM+.05&&next.distanceM>=this.observation.distanceM-L.positionHysteresisM){
      this.observation={...next,distanceM:this.observation.distanceM};if(this.frame){this.frame={...this.frame,observedAt:timestamp};this.emit();}return;
    }
    const passed=Math.max(-1,...tracking.stopProjections.filter(stop=>tracking.stopStates.some(state=>state.sequence===stop.sequence&&state.state==="PASSED")).map(stop=>stop.distanceM??-1));
    const plan=interpolationPlan(this.observation,next,this.frame?.distanceM??next.distanceM,reducedMotion,passed);
    if(plan.mode==="IGNORE")return;
    this.cancel();this.shape=shape;this.observation={...next,distanceM:plan.to};this.started=this.clock.now();this.plan=plan;
    this.frame={key,vehicleId:tracking.vehicleId,distanceM:plan.from,targetDistanceM:plan.to,point:tracking.position,segment:0,heading:0,observedAt:timestamp,playing:plan.mode==="ANIMATE",interpolated:plan.mode==="ANIMATE",stale:false};
    this.setDistance(plan.from,plan.mode==="ANIMATE",false);
    if(plan.mode==="ANIMATE")this.schedule();else this.plan=null;
  }
  private setDistance(distance:number,playing:boolean,stale:boolean){
    if(!this.shape||!this.frame)return;
    const location=pointAtDistance(this.shape,distance);let segment=location.segment;
    while(segment<this.shape.path.length-2&&this.shape.cumulative[segment+1]-this.shape.cumulative[segment]<.1)segment++;
    this.frame={...this.frame,distanceM:distance,point:location.point,segment:location.segment,heading:bearing(this.shape.path[segment],this.shape.path[segment+1]),playing,interpolated:Math.abs(distance-this.frame.targetDistanceM)>.05,stale};this.emit();
  }
  private advance(){
    if(!this.frame||!this.plan||this.plan.mode!=="ANIMATE")return;
    if(this.clock.wallNow()-this.frame.observedAt>L.maxAgeMs){this.cancel();this.observation=null;this.frame={...this.frame,playing:false,stale:true};this.emit();return;}
    const ratio=Math.max(0,Math.min(1,(this.clock.now()-this.started)/this.plan.durationMs));
    const distance=this.plan.from+(this.plan.to-this.plan.from)*ratio;
    this.setDistance(distance,ratio<1,false);if(ratio>=1)this.plan=null;
  }
  private schedule(){this.handle=this.clock.request(()=>{this.handle=null;this.advance();if(this.plan)this.schedule();});}
}
export const browserAnimationClock:AnimationClock={now:()=>performance.now(),wallNow:()=>Date.now(),request:callback=>requestAnimationFrame(callback),cancel:handle=>cancelAnimationFrame(handle)};
export type TimelineAnchor={sequence:number;distanceM:number;y:number;name:string};
export function timelinePosition(anchors:TimelineAnchor[],distance:number,routeLength:number){
  const ordered=anchors.filter(item=>Number.isFinite(item.distanceM)&&Number.isFinite(item.y));
  const next=ordered.findIndex(item=>item.distanceM>=distance);
  if(next>0){const a=ordered[next-1],b=ordered[next],span=b.distanceM-a.distanceM;if(span<=0)return null;const fraction=Math.max(0,Math.min(1,(distance-a.distanceM)/span));return {y:a.y+(b.y-a.y)*fraction,fraction,previous:a,next:b};}
  if(next===0){const b=ordered[0],fraction=b.distanceM>0?Math.max(0,Math.min(1,distance/b.distanceM)):1;return {y:Math.max(0,b.y-80)+Math.min(80,b.y)*fraction,fraction,previous:null,next:b};}
  const a=ordered.at(-1);if(!a)return null;
  const fraction=routeLength>a.distanceM?Math.max(0,Math.min(1,(distance-a.distanceM)/(routeLength-a.distanceM))):0;
  return {y:a.y+60*fraction,fraction,previous:a,next:null};
}
