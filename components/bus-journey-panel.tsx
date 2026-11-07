"use client";
import "@/app/bus-journey.css";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { BUS_POSITION_MAX_AGE, type BusJourney } from "@/lib/bus-journey";
import { arrivalClock, boardDate, malaysiaDay, safeTimetableSource } from "@/lib/departure-board";
import { newerJourney, currentTracking } from "@/lib/bus-progress";
import type { VehicleProgress } from "@/lib/vehicle-progress";
import { GpsEvidence, GpsTimelinePosition } from "./gps-progress";
import { RouteAnimator, browserAnimationClock } from "@/lib/route-animation";
import { journeySelectionKey, retainedStopSelection, selectJourneyStop, type SelectedJourneyStop } from "@/lib/journey-stop-selection";

export type BusMapJourney={vehicleId:string;path:[number,number][]|null;tripId:string|null;tracking?:VehicleProgress;motion?:RouteAnimator;selectedStop?:SelectedJourneyStop|null;navigation?:number;locate?:number;lastSeen?:{position:[number,number]|null;timestamp:string|null;available:boolean;name:string}};
type Props={record:TransitRecord;onClose:()=>void;onPathChange:(journey:BusMapJourney)=>void;children?:ReactNode};
const destination=(value:string|null|undefined)=>value?/^from\s+.+?\s+to\s+(.+)$/i.exec(value)?.[1]??value:"Destination unavailable";
const stamp=(value:string)=>`${boardDate(value)}, ${arrivalClock(value)} MYT`;
export default function BusJourneyPanel(props:Props){
  return <Journey key={`${props.record.feedId}:${props.record.id}:${props.record.tripId}`} {...props}/>;
}
function Journey({record,onClose,onPathChange,children}:Props){
  const [data,setData]=useState<BusJourney|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [departure,setDeparture]=useState<string|null>(null),[direction,setDirection]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
  const [previous,setPrevious]=useState(false),[expanded,setExpanded]=useState(true),[now,setNow]=useState(Date.now),[allFrequency,setAllFrequency]=useState(false);
  const busy=useRef(false),lastRequest=useRef(0),lastManual=useRef(0),body=useRef<HTMLDivElement>(null),id=useId();
  const [motion]=useState(()=>new RouteAnimator(browserAnimationClock));
  const [selection,setSelection]=useState<SelectedJourneyStop|null>(null),[navigation,setNavigation]=useState(0),[locate,setLocate]=useState(0);
  const retained=retainedStopSelection(selection,data);
  const selectedFresh=!!data&&data.vehicle.realtimeAvailable&&data.progress.status!=="TIMETABLE_PREVIEW"&&data.vehicle.positionStatus==="CURRENT"&&!!data.vehicle.reportedAt&&now-Date.parse(data.vehicle.reportedAt)<=BUS_POSITION_MAX_AGE&&Date.parse(data.vehicle.reportedAt)-now<=30000;
  const selectedStop=retained?{...retained,status:selectedFresh?retained.status:"UNKNOWN" as const,confidence:selectedFresh?retained.confidence:"LOW"}:null;
  const runKey=data?journeySelectionKey(data):null;
  useEffect(()=>{setSelection(null);},[runKey]);
  useEffect(()=>{const media=window.matchMedia("(prefers-reduced-motion: reduce)"),change=()=>motion.setReducedMotion(media.matches);change();media.addEventListener("change",change);return()=>{media.removeEventListener("change",change);motion.dispose();};},[motion]);
  const query=new URLSearchParams({source:record.feedId??"",vehicle:record.id});
  if(record.tripId)query.set("trip",record.tripId);if(record.routeId)query.set("route",record.routeId);
  const observation=record.observation;
  if(observation?.tripStartDate)query.set("date",observation.tripStartDate);if(observation?.tripStartTime)query.set("start",observation.tripStartTime);if(observation?.positionTimestamp)query.set("observed",observation.positionTimestamp);
  if(departure)query.set("departure",departure);if(direction!==null)query.set("direction",direction);
  const queryKey=query.toString();
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==="Escape"&&!event.defaultPrevented)onClose();};document.addEventListener("keydown",close);return()=>document.removeEventListener("keydown",close);},[onClose]);
  useEffect(()=>{
    if(!record.feedId){setLoading(false);setError("The official bus source reference is unavailable. Vehicle details and any retrieved route path are retained.");return;}
    const controller=new AbortController();let active=true;busy.current=true;lastRequest.current=Date.now();setLoading(true);setError("");
    const timeout=setTimeout(()=>controller.abort(),25000);
    fetch(`/api/bus-journey?${queryKey}`,{signal:controller.signal,cache:"no-store"}).then(async response=>{
      if(!response.ok){const result=await response.json().catch(()=>null);throw new Error(result?.error??"Could not retrieve the official bus journey.");}
      const next=await response.json() as BusJourney;if(!Array.isArray(next.stops)||!Array.isArray(next.departures)||!next.match||next.vehicle.id!==record.id)throw new Error("The official journey response was incomplete.");
      if(active){setData(current=>newerJourney(current,next));setNow(Date.now());}
    }).catch(reason=>{if(active)setError(`${reason instanceof Error&&reason.name!=="AbortError"?reason.message:"Could not refresh the official bus journey."} Previously retrieved information is retained.`);})
      .finally(()=>{clearTimeout(timeout);if(active){busy.current=false;setLoading(false);}});
    return()=>{active=false;controller.abort();clearTimeout(timeout);busy.current=false;};
  },[queryKey,refresh,record.id,record.feedId]);
  useEffect(()=>{if(data&&!busy.current&&now-lastRequest.current>=30000)setRefresh(value=>value+1);},[now,data]);
  const tracking=useMemo(()=>currentTracking(data?.tracking,now,data?.vehicle.realtimeAvailable!==false&&data?.progress.status!=="TIMETABLE_PREVIEW"),[data?.tracking,data?.vehicle.realtimeAvailable,data?.progress.status,now]);
  useEffect(()=>{motion.update(data?.path??null,tracking,data?.route?.id??null);},[data?.path,data?.route?.id,tracking,motion]);
  useEffect(()=>{if(data)onPathChange({vehicleId:record.id,path:data.path,tripId:data.selectedDeparture?.tripId??null,tracking,motion,selectedStop,navigation,locate,lastSeen:{position:data.vehicle.position??record.position,timestamp:data.vehicle.reportedAt??record.observation?.positionTimestamp??null,available:data.vehicle.realtimeAvailable,name:record.name}});},[data,tracking,onPathChange,record.id,motion,selectedStop?.key,selectedStop?.status,selectedStop?.confidence,navigation,locate]);
  const reload=()=>{if(busy.current||Date.now()-lastManual.current<1000)return;lastManual.current=Date.now();busy.current=true;setLoading(true);setRefresh(value=>value+1);};
  const stale=!!data?.vehicle.reportedAt&&(now-Date.parse(data.vehicle.reportedAt)>BUS_POSITION_MAX_AGE||Date.parse(data.vehicle.reportedAt)-now>30000);
  const reliable=!!data&&data.vehicle.realtimeAvailable&&data.vehicle.positionStatus==="CURRENT"&&!stale;
  const preview=data?.progress.status==="TIMETABLE_PREVIEW";
  const stops=(data?.stops??[]).map(stop=>reliable&&!preview?stop:{...stop,status:"UNKNOWN" as const});
  const gpsActive=reliable&&!preview&&(tracking?.source==="GPS_INFERRED"||tracking?.source==="APPROXIMATE");
  const lastGpsPassed=stops.filter(stop=>stop.status==="PASSED").at(-1)?.sequence;
  const isEarlier=(stop:typeof stops[number])=>stop.status==="DEPARTED"||stop.status==="PASSED"&&stop.sequence!==lastGpsPassed;
  const previousCount=stops.filter(isEarlier).length;
  const visible=stops.filter(stop=>previous||!isEarlier(stop)||selectedStop?.id===stop.id&&selectedStop.sequence===stop.sequence);
  const scrollInside=(element:HTMLElement|null)=>{const container=body.current;if(!element||!container)return;const row=element.getBoundingClientRect(),box=container.getBoundingClientRect();if(row.top<box.top)container.scrollTop+=row.top-box.top-8;else if(row.bottom>box.bottom)container.scrollTop+=row.bottom-box.bottom+8;};
  const chooseStop=(stop:typeof stops[number],element:HTMLElement)=>{if(!data)return;setSelection(selectJourneyStop({...data,stops},stop.id,stop.sequence));setNavigation(value=>value+1);scrollInside(element);};
  const locateBus=()=>{setSelection(null);setLocate(value=>value+1);scrollInside(body.current?.querySelector<HTMLElement>(".bus-timeline-position,.bus-progress")??null);};
  const togglePrevious=()=>{
    const anchor=body.current?.querySelector(`[data-sequence="${data?.progress.sequence}"]`),offset=anchor?.getBoundingClientRect().top;
    setPrevious(value=>!value);requestAnimationFrame(()=>{if(body.current&&anchor&&offset!==undefined)body.current.scrollTop+=anchor.getBoundingClientRect().top-offset;});
  };
  const progress=!data?"":preview?data.progress.message:!data.vehicle.realtimeAvailable?"Realtime unavailable — displaying the official timetable only.":stale?"Last seen vehicle position is stale — progress and delay are unavailable.":tracking?.reason??data.progress.message;
  const code=data?.route?.code??record.route??record.routeId??"Route unavailable";
  const title=data?.route?.name??record.route??"Bus journey";
  return <section className={`bus-journey ${expanded?"bus-sheet-expanded":"bus-sheet-collapsed"}`} aria-label="Bus journey detail" aria-busy={loading}>
    <div className="bus-journey-header"><div className="bus-sheet-grip" aria-hidden="true"/><div className="bus-header-actions"><button type="button" className="bus-sheet-toggle" aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(value=>!value)}>{expanded?"Collapse journey":"Expand journey"}</button><button type="button" className="bus-close" aria-label="Close bus journey" onClick={onClose}>×</button></div>
      <p className="bus-eyebrow">BUS JOURNEY <span>{record.id}</span></p><h2><span aria-hidden="true">🚌</span> <span className="bus-route-badge">{code}</span></h2>{title!==code&&<p className="bus-route-title">{title}</p>}
      <p className="bus-origin">{data?.route?.origin?`From ${data.route.origin}`:"Origin unavailable"}</p><p className="bus-destination">Towards {destination(data?.route?.destination)}</p><p className="bus-meta">{data?.route?.direction!==null&&data?.route?.direction!==undefined?`Direction ${data.route.direction} · `:""}{record.operator}</p>
    </div>
    <div className="bus-journey-body" id={id} ref={body}>
      <div className="bus-toolbar"><span className={`bus-observation ${reliable?"bus-observation-current":""} ${stale||data?.vehicle.positionStatus==="STALE"?"bus-stale":""}`}>{!data?loading?"Matching official trip…":"TIMETABLE UNAVAILABLE":!data.vehicle.realtimeAvailable?"REALTIME UNAVAILABLE":stale||data.vehicle.positionStatus==="STALE"?"STALE POSITION":data.vehicle.positionStatus==="CURRENT"?"LIVE POSITION":"POSITION TIME UNKNOWN"}</span><button type="button" className="bus-refresh" aria-label="Refresh bus journey" disabled={loading} onClick={reload}>{loading?"Loading…":"↻ Refresh"}</button></div>
      <p className="bus-loading" role="status" aria-live="polite">{loading?data?"Refreshing official journey…":"Retrieving official trip and stop sequence…":data?`Updated ${arrivalClock(data.retrievedAt)} MYT · ${data.stops.length} stops`:""}</p>
      {reliable&&!preview&&<button type="button" className="bus-text-button bus-locate" onClick={locateBus}>◎ Locate bus</button>}
      {selectedStop&&!selectedStop.position&&<p className="bus-fallback" role="status">Map location unavailable for {selectedStop.name} (Stop {selectedStop.id}).</p>}
      {error&&<p className="bus-error" role="alert">{error} <button type="button" disabled={loading} onClick={reload}>Retry</button></p>}
      {data&&<>
        {data.match.status!=="MATCHED"&&<p className="bus-fallback" role="status">{data.match.reason}</p>}
        {data.selectionWarning&&<p className="bus-fallback" role="status">{data.selectionWarning}</p>}
        {data.route&&<section className="bus-departure-section" aria-label="Bus departure options"><h3>Journey options</h3>
          {!data.vehicleDeparture&&data.route.directions.length>0&&<label className="bus-direction-select">View a timetable direction<select aria-label="Bus timetable direction" value={direction??data.route.direction??""} onChange={event=>{setDirection(event.target.value||null);setDeparture(null);setPrevious(false);}}><option value="">Choose direction</option>{data.route.directions.map(value=><option key={value} value={value}>Direction {value}</option>)}</select></label>}
          <div className="bus-departure-options" role="group" aria-label="Select bus departure">
            {data.vehicleDeparture&&<button type="button" className={data.selectedDeparture?.key===data.vehicleDeparture.key?"bus-departure-option selected":"bus-departure-option"} aria-pressed={data.selectedDeparture?.key===data.vehicleDeparture.key} disabled={loading} onClick={()=>{setDeparture(null);setDirection(null);setPrevious(false);}}><span>{data.vehicle.realtimeAvailable?"Vehicle journey":"Timetable reference"}</span><strong>{arrivalClock(data.vehicleDeparture.departure)}</strong><small>{data.vehicleDeparture.classification} · {boardDate(data.vehicleDeparture.departure)}</small></button>}
            {data.departures.filter(option=>option.key!==data.vehicleDeparture?.key).map(option=><button type="button" className={data.selectedDeparture?.key===option.key?"bus-departure-option selected":"bus-departure-option"} key={option.key} aria-pressed={data.selectedDeparture?.key===option.key} disabled={loading} onClick={()=>{setDeparture(option.key);setPrevious(false);}}><span>Scheduled departure</span><strong>{arrivalClock(option.departure)}</strong><small>{boardDate(option.departure)} · {destination(option.destination)}</small></button>)}
          </div>
          {!data.departures.length&&<p className="bus-caption">No upcoming exact scheduled departures are published for this direction. Frequency information is shown separately where available.</p>}
        </section>}
        {data.frequencies.length>0&&<section className="bus-frequency" aria-label="Bus service frequency"><h3>Published service frequency</h3>{data.frequencies.slice(0,allFrequency?data.frequencies.length:1).map((window,index)=><div key={`${window.start}:${window.end}:${index}`}><strong>Every {Math.round(window.headwaySeconds/6)/10} min</strong><span>{boardDate(window.start)} · {arrivalClock(window.start)}–{arrivalClock(window.end)}{malaysiaDay(window.start)!==malaysiaDay(window.end)?` (${boardDate(window.end)})`:""} MYT</span><small>Towards {destination(window.destination)}</small></div>)}{data.frequencies.length>1&&<button type="button" className="bus-text-button" aria-expanded={allFrequency} onClick={()=>setAllFrequency(value=>!value)}>{allFrequency?"Show fewer frequency periods":"Show all frequency periods"}</button>}<p className="bus-caption">Headways do not specify exact future departures.</p></section>}
        {stops.length>0&&<>
          <div className="bus-progress" role="status"><span aria-hidden="true">🚌</span> <strong>{progress}</strong></div>
          {tracking&&!preview&&<GpsEvidence tracking={tracking}/>}
          {reliable&&data.delay&&!preview&&<p className="bus-delay" title={data.delay.basis}>At least {data.delay.minimumMinutes} min late departing · observed {arrivalClock(data.delay.observedAt)}</p>}
          <div className="bus-timeline-heading"><h3>Stop timeline</h3><span>{data.selectedDeparture?boardDate(data.selectedDeparture.departure):"Times unavailable"} · MYT</span></div>
          {data.selectedDeparture&&<p className="bus-time-basis">{data.selectedDeparture.classification} · {data.selectedDeparture.basis}</p>}
          {previousCount>0&&<button type="button" className="bus-previous-toggle" aria-expanded={previous} onClick={togglePrevious}>{previous?"Hide previous stops":"Show previous stops"} ({previousCount})</button>}
          <ol className="bus-stop-timeline" aria-label="Bus stop sequence">{visible.map(stop=>{
            const next=reliable&&!preview&&!gpsActive&&stop.sequence===data.progress.sequence&&stop.status!=="DEPARTED";
            const first=stop.sequence===stops[0]?.sequence,primary=first?stop.departure??stop.arrival:stop.arrival??stop.departure;
            return <Fragment key={`${stop.sequence}:${stop.id}`}>
              {gpsActive&&tracking?.nextStopSequence===stop.sequence&&<GpsTimelinePosition motion={motion} tracking={tracking} previousName={stops.find(item=>item.sequence===tracking.previousPassedStopSequence)?.name} nextName={stop.name}/>}
              <li data-sequence={stop.sequence} data-stop-id={stop.id} className={`bus-stop bus-stop-${stop.status.toLowerCase()} ${selectedStop?.id===stop.id&&selectedStop.sequence===stop.sequence?"bus-stop-selected":""} ${next?"bus-stop-next":""} ${gpsActive&&tracking?.nextStopSequence===stop.sequence?"bus-gps-next":""}`}>
              <span className="bus-stop-node" aria-hidden="true">{next?"🚌":""}</span><button type="button" className="bus-stop-content bus-stop-control" aria-label={`Show ${stop.name} on map (sequence ${stop.sequence})`} aria-pressed={selectedStop?.id===stop.id&&selectedStop.sequence===stop.sequence} onClick={event=>chooseStop(stop,event.currentTarget)}><strong>{stop.name}</strong><span className="bus-stop-status">{stop.status==="PASSED"?"Passed · Progress inferred from GPS":stop.status==="DEPARTED"?"Passed · LIVE PROGRESS":stop.status==="CURRENT"?"At stop":stop.status==="UPCOMING"?next?"Next stop":"Upcoming":"Vehicle progress unknown"}</span>
                {primary?<div className="bus-stop-times"><span>{first||!stop.arrival?"Departure":"Arrival"} <time dateTime={primary}>{arrivalClock(primary)}</time>{malaysiaDay(primary)!==malaysiaDay(data.selectedDeparture?.departure??now)&&<small> {boardDate(primary)}</small>}</span>{!first&&stop.arrival&&stop.departure&&stop.arrival!==stop.departure&&<span>Departs <time dateTime={stop.departure}>{arrivalClock(stop.departure)}</time></span>}<span className={stop.classification==="ESTIMATED"?"bus-time-label bus-estimated":"bus-time-label"}>{stop.classification}</span></div>:<span className="bus-caption">Stop time unavailable</span>}
                <small className="bus-stop-code">Stop {stop.id} · Sequence {stop.sequence}</small>
                {!stop.position&&<small className="bus-stop-code">Map location unavailable</small>}
              </button>
            </li></Fragment>;
          })}{gpsActive&&tracking?.status==="BEYOND_LAST"&&<GpsTimelinePosition motion={motion} tracking={tracking} previousName={stops.find(item=>item.sequence===tracking.previousPassedStopSequence)?.name}/>}</ol>
        </>}
        {!stops.length&&<p className="bus-empty" role="status">{data.route?"No reliable vehicle trip timeline is available. Select a published departure, where available, to view its timetable.":"No matching official trip or route was found. Vehicle details and any available route path are retained."}</p>}
        <div className="bus-data-note"><p>LIVE POSITION is a vehicle observation, not a live arrival prediction.</p><p>{data.selectedDeparture?.classification==="ESTIMATED"?"Estimated stop times use the reported trip start and official GTFS offsets. Actual arrivals may differ.":"Scheduled times describe the timetable; they do not confirm actual arrivals or departures."}</p><p>Live arrival predictions: unavailable.</p>{!data.path&&<p>Route geometry is unavailable for this selected trip.</p>}<p>{stale||!data.vehicle.realtimeAvailable?"Last seen":"Vehicle measured"}: {data.vehicle.reportedAt?stamp(data.vehicle.reportedAt):"Not provided"}</p></div>
      </>}
      <details className="bus-technical"><summary>Vehicle details &amp; data sources</summary>{children}{data&&<><p>Trip match: {data.match.status} · {data.match.method??"No verified vehicle match"}</p>{data.match.routeAlias&&<p>Realtime route code verified against a unique official route name.</p>}<p>Selected trip: {data.selectedDeparture?.tripId??"Unresolved"}</p><p>Static timetable retrieved: {stamp(data.staticUpdatedAt)}</p>{safeTimetableSource(data.source)&&<a href={data.source} target="_blank" rel="noreferrer">Official GTFS timetable</a>}</>}</details>
    </div>
  </section>;
}
