import type { VehicleProgress } from "@/lib/vehicle-progress";
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
export function GpsTimelinePosition({tracking,previousName,nextName}:{tracking:VehicleProgress;previousName?:string;nextName?:string}){
  return <li className="bus-timeline-position" aria-label="Current vehicle position">
    <span className="bus-position-node" aria-hidden="true">🚌</span><strong>{tracking.reason}</strong>
    <span className="gps-position-label">{progressLabel(tracking.source)} · {tracking.confidence} confidence</span>
    {previousName&&<span>Previous passed stop: {previousName}</span>}{nextName&&<span>Next stop: {nextName}</span>}
    {tracking.vehicleTimestamp&&<span>Last GPS update {gpsClock(tracking.vehicleTimestamp)} MYT</span>}
    <small>GPS progress does not confirm stop service or an actual departure time.</small>
  </li>;
}
