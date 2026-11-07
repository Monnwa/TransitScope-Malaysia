export type GeoPoint = [number,number]; // GTFS WGS84 [latitude, longitude].
export const PROGRESS_LIMITS = {
  maxAgeMs:120000, futureToleranceMs:30000, maxRouteOffsetM:60, highRouteOffsetM:25,
  maxStopOffsetM:100, anchorToleranceM:100, ambiguitySlackM:12, clusterDistanceM:40,
  stopBacktrackM:15, positionHysteresisM:30, passedBufferM:50, approachingM:45,
  minimumMovementM:40, minimumObservationMs:15000, maximumSpeedMps:40,
  headingToleranceDeg:55, maxAccuracyM:50, highAccuracyM:25, maxShapeSegmentM:5000
} as const;
export type Projection = {distanceM:number;offsetM:number;point:GeoPoint;segment:number;bearing:number};
export type ShapeIndex = {path:GeoPoint[];cumulative:number[];lengthM:number;fingerprint:string};
export type StopProjection = {id:string;sequence:number;name:string;distanceM:number|null;offsetM:number|null;confidence:"HIGH"|"LOW";reason:string|null};
type StopInput={id:string;sequence:number;name:string;position:GeoPoint|null;shapeDistance:number|null};
const radians=(value:number)=>value*Math.PI/180;
export const validPoint=(point:GeoPoint|null|undefined):point is GeoPoint=>!!point&&point.length===2&&point.every(Number.isFinite)&&Math.abs(point[0])<=90&&Math.abs(point[1])<=180;
export function distanceM(a:GeoPoint,b:GeoPoint){const dLat=radians(b[0]-a[0]),dLon=radians(b[1]-a[1]),h=Math.sin(dLat/2)**2+Math.cos(radians(a[0]))*Math.cos(radians(b[0]))*Math.sin(dLon/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));}
export function bearing(a:GeoPoint,b:GeoPoint){const dLon=radians(b[1]-a[1]),aLat=radians(a[0]),bLat=radians(b[0]);return (Math.atan2(Math.sin(dLon)*Math.cos(bLat),Math.cos(aLat)*Math.sin(bLat)-Math.sin(aLat)*Math.cos(bLat)*Math.cos(dLon))*180/Math.PI+360)%360;}
export const angleDifference=(a:number,b:number)=>Math.abs(((a-b+540)%360)-180);
const shapeCache=new WeakMap<GeoPoint[],ShapeIndex|null>();
export function indexShape(path:GeoPoint[]):ShapeIndex|null {
  if(shapeCache.has(path))return shapeCache.get(path)!;
  if(path.length<2||path.some(point=>!validPoint(point))){shapeCache.set(path,null);return null;}
  const cumulative=[0];let hash=2166136261;
  for(let i=0;i<path.length;i++){
    for(const value of path[i]){hash^=Math.round(value*1e7);hash=Math.imul(hash,16777619);}
    if(i){const length=distanceM(path[i-1],path[i]);if(length>PROGRESS_LIMITS.maxShapeSegmentM){shapeCache.set(path,null);return null;}cumulative.push(cumulative[i-1]+length);}
  }
  const result=cumulative.at(-1)!>1?{path,cumulative,lengthM:cumulative.at(-1)!,fingerprint:`${path.length}:${hash>>>0}`}:null;
  shapeCache.set(path,result);return result;
}
export function projectCandidates(shape:ShapeIndex,point:GeoPoint,maxOffset:number):Projection[]{
  if(!validPoint(point))return [];
  const candidates:Projection[]=[];
  for(let i=0;i<shape.path.length-1;i++){
    const a=shape.path[i],b=shape.path[i+1],length=shape.cumulative[i+1]-shape.cumulative[i];if(length<.1)continue;
    const cos=Math.cos(radians((a[0]+b[0]+point[0])/3));
    const dx=(b[1]-a[1])*cos,dy=b[0]-a[0],px=(point[1]-a[1])*cos,py=point[0]-a[0];
    const t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy)));
    const foot:GeoPoint=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])],offset=distanceM(point,foot);
    if(offset<=maxOffset)candidates.push({distanceM:shape.cumulative[i]+t*length,offsetM:offset,point:foot,segment:i,bearing:bearing(a,b)});
  }
  return candidates;
}
export function distinctCandidates(values:Projection[],slack=PROGRESS_LIMITS.ambiguitySlackM):Projection[]{
  if(!values.length)return [];
  const best=Math.min(...values.map(item=>item.offsetM));
  const sorted=values.filter(item=>item.offsetM<=best+slack).sort((a,b)=>a.distanceM-b.distanceM),groups:Projection[][]=[];
  for(const item of sorted){const last=groups.at(-1);if(last&&item.distanceM-last.at(-1)!.distanceM<=PROGRESS_LIMITS.clusterDistanceM)last.push(item);else groups.push([item]);}
  return groups.map(group=>group.reduce((a,b)=>a.offsetM<=b.offsetM?a:b));
}
function anchorDistance(shape:ShapeIndex,references:number[],value:number):number|null {
  if(references.length!==shape.path.length||references.some((ref,i)=>!Number.isFinite(ref)||ref<0||i>0&&ref<references[i-1])||value<references[0]||value>references.at(-1)!)return null;
  for(let i=0;i<references.length-1;i++){const span=references[i+1]-references[i];if(span>0&&value>=references[i]&&value<=references[i+1])return shape.cumulative[i]+(value-references[i])/span*(shape.cumulative[i+1]-shape.cumulative[i]);}
  return null;
}
export function pointAtDistance(shape:ShapeIndex,value:number):{point:GeoPoint;segment:number}{
  const bounded=Math.max(0,Math.min(shape.lengthM,value));let i=0;while(i<shape.path.length-2&&shape.cumulative[i+1]<bounded)i++;
  const span=shape.cumulative[i+1]-shape.cumulative[i],t=span?(bounded-shape.cumulative[i])/span:0;
  return {point:[shape.path[i][0]+t*(shape.path[i+1][0]-shape.path[i][0]),shape.path[i][1]+t*(shape.path[i+1][1]-shape.path[i][1])],segment:i};
}
export function projectStops(shape:ShapeIndex,stops:StopInput[],references?:number[]):StopProjection[]{
  const candidates:Projection[][]=[],reasons:(string|null)[]=[];
  for(const stop of stops){
    if(!validPoint(stop.position)){candidates.push([]);reasons.push("Official stop coordinates unavailable or invalid.");continue;}
    let values=projectCandidates(shape,stop.position,PROGRESS_LIMITS.maxStopOffsetM),reason:string|null=null;
    if(references&&stop.shapeDistance!==null){
      const anchor=anchorDistance(shape,references,stop.shapeDistance);
      if(anchor===null||distanceM(stop.position,pointAtDistance(shape,anchor).point)>PROGRESS_LIMITS.anchorToleranceM){values=[];reason="Published shape-distance anchor conflicts with the stop coordinate.";}
      else values=values.filter(value=>Math.abs(value.distanceM-anchor)<=PROGRESS_LIMITS.anchorToleranceM);
    }
    const distinct=distinctCandidates(values);candidates.push(distinct);reasons.push(reason??(!distinct.length?"Stop is too far from its matched trip shape.":null));
  }
  const usable=candidates.map((values,i)=>values.length?i:-1).filter(i=>i>=0);
  const forward=usable.map(i=>candidates[i].map(()=>false)),backward=usable.map(i=>candidates[i].map(()=>false));
  for(let step=0;step<usable.length;step++)for(let j=0;j<candidates[usable[step]].length;j++)forward[step][j]=step===0||candidates[usable[step-1]].some((prior,k)=>forward[step-1][k]&&prior.distanceM<=candidates[usable[step]][j].distanceM+PROGRESS_LIMITS.stopBacktrackM);
  for(let step=usable.length-1;step>=0;step--)for(let j=0;j<candidates[usable[step]].length;j++)backward[step][j]=step===usable.length-1||candidates[usable[step+1]].some((next,k)=>backward[step+1][k]&&candidates[usable[step]][j].distanceM<=next.distanceM+PROGRESS_LIMITS.stopBacktrackM);
  const feasible=new Map<number,Projection[]>();for(let step=0;step<usable.length;step++)feasible.set(usable[step],candidates[usable[step]].filter((_,j)=>forward[step][j]&&backward[step][j]));
  return stops.map((stop,i)=>{const values=feasible.get(i)??[],match=values.length===1?values[0]:null;return {id:stop.id,sequence:stop.sequence,name:stop.name,distanceM:match?.distanceM??null,offsetM:match?.offsetM??null,confidence:match?"HIGH":"LOW",reason:match?null:reasons[i]??(values.length>1?"Stop maps to multiple route branches or loop occurrences.":"Stop projection conflicts with GTFS stop-sequence order.")};});
}
export function splitRoutePath(path:GeoPoint[],segment:number,point:GeoPoint){
  if(!validPoint(point)||!Number.isInteger(segment)||segment<0||segment>=path.length-1)return null;
  return {completed:[...path.slice(0,segment+1),point],remaining:[point,...path.slice(segment+1)]};
}
