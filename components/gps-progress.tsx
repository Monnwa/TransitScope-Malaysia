import type { VehicleProgress } from "@/lib/vehicle-progress";
import { useLayoutEffect, useRef } from "react";
import { timelinePosition, type RouteAnimator, type TimelineAnchor } from "@/lib/route-animation";
export const progressLabel=(source:VehicleProgress["source"])=>({GPS_INFERRED:"GPS-INFERRED",APPROXIMATE:"APPROXIMATE",PROGRESS_UNKNOWN:"PROGRESS UNKNOWN",LIVE_PROGRESS:"LIVE PROGRESS",STALE:"STALE"})[source];
const gpsClock=(value:string)=>new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Kuala_Lumpur",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).format(new Date(value));
export function GpsEvidence({tracking}:{tracking:VehicleProgress}){
  return <div className="gps-evidence" aria-label="Vehicle progress evidence">
    <span className={`gps-source gps-source-${tracking.source.toLowerCase()}`}>{progressLabel(tracking.source)}</span><span>{tracking.confidence} confidence</span>
    {tracking.vehicleTimestamp&&<span>{tracking.source==="STALE"?"Last seen":"GPS measured"} <time dateTime={tracking.vehicleTimestamp}>{gpsClock(tracking.vehicleTimestamp)}</time> MYT</span>}
    {tracking.offsetM!==null&&<span>Route offset {Math.round(tracking.offsetM)} m</span>}
    <span>{tracking.accuracyM===null?"GPS accuracy not supplied":`Reported accuracy ${Math.round(tracking.accuracyM)} m`}</span>
    {tracking.source==="PROGRESS_UNKNOWN"&&tracking.lastSuccessfulMatchTime&&<span>Last reliable match {gpsClock(tracking.lastSuccessfulMatchTime)}</span>}
  </div>;
}
export function GpsTimelinePosition({tracking,previousName,nextName,motion}:{tracking:VehicleProgress;previousName?:string;nextName?:string;motion?:RouteAnimator}){
  const row=useRef<HTMLLIElement>(null),icon=useRef<HTMLSpanElement>(null),label=useRef<HTMLSpanElement>(null);
  useLayoutEffect(()=>{
    const element=row.current,list=element?.closest("ol"),node=icon.current;if(!element||!list||!node||!motion)return;
    let anchors:TimelineAnchor[]=[],origin=0;
    const draw=()=>{const frame=motion.getFrame(),shape=motion.getShape();if(!frame||!shape||tracking.confidence!=="HIGH"){node.style.transform="";return;}
      const position=timelinePosition(anchors,frame.distanceM,shape.lengthM);if(!position)return;
      node.style.transform=`translateY(${position.y-origin-13.5}px)`;node.dataset.distance=String(frame.distanceM);node.dataset.fraction=String(position.fraction);node.dataset.playing=String(frame.playing);node.dataset.stale=String(frame.stale);
      if(label.current)label.current.textContent=frame.stale?"Last seen · animation stopped":frame.interpolated?"Visual interpolation · not a new GPS observation":"Latest matched GPS position";
    };
    const measure=()=>{const listTop=list.getBoundingClientRect().top;origin=element.getBoundingClientRect().top-listTop;anchors=Array.from(list.querySelectorAll<HTMLElement>(".bus-stop[data-sequence]")).flatMap(item=>{const stop=tracking.stopProjections.find(stop=>stop.sequence===Number(item.dataset.sequence)),dot=item.querySelector(".bus-stop-node");if(!stop||stop.distanceM===null||!dot)return [];const rect=dot.getBoundingClientRect();return [{sequence:stop.sequence,distanceM:stop.distanceM,y:rect.top-listTop+rect.height/2,name:stop.name}];});draw();};
    const observer=new ResizeObserver(measure);observer.observe(list);measure();const unsubscribe=motion.subscribe(draw);return()=>{observer.disconnect();unsubscribe();};
  },[motion,tracking]);
  return <li ref={row} className="bus-timeline-position" aria-label="Current vehicle position">
    <span ref={icon} className="bus-position-node" aria-hidden="true">🚌</span><strong>{tracking.reason}</strong>
    <span ref={label} className="bus-motion-label">Latest matched GPS position</span>
    <span className="gps-position-label">{progressLabel(tracking.source)} · {tracking.confidence} confidence</span>
    {previousName&&<span>Previous passed stop: {previousName}</span>}{nextName&&<span>Next stop: {nextName}</span>}
    {tracking.vehicleTimestamp&&<span>Last GPS update {gpsClock(tracking.vehicleTimestamp)} MYT</span>}
    <small>GPS progress does not confirm stop service or an actual departure time.</small>
  </li>;
}
