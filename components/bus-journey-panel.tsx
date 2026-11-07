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
import { adherenceSummary,displayedAdherence } from "@/lib/timetable-adherence";
import { StopTimetableAdherence,AdherenceSummary } from "./timetable-adherence";
import { journeyLocationText,passengerName,publicRouteCode,publicRouteName,sentenceCase } from "./passenger-copy";
import { estimatedBusArrival,estimatedBusArrivalLabel } from "@/lib/bus-motion";

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
  const stops=(data?.stops??[]).map(stop=>({...stop,status:reliable&&!preview?stop.status:"UNKNOWN" as const,adherence:displayedAdherence(stop.adherence,reliable&&!preview&&tracking?.source==="GPS_INFERRED"&&tracking.confidence==="HIGH")}));
  const summary=adherenceSummary(stops);
  const gpsActive=reliable&&!preview&&(tracking?.source==="GPS_INFERRED"||tracking?.source==="APPROXIMATE");
  const nextArrival=reliable&&!preview&&data?.match.status==="MATCHED"?estimatedBusArrival(tracking,now):null;
  const arrivalExpiry=nextArrival?.expiresAt;
  useEffect(()=>{
    if(arrivalExpiry===undefined)return;
    const deadline=setTimeout(()=>setNow(Date.now()),Math.max(0,arrivalExpiry-Date.now()));
    return()=>clearTimeout(deadline);
  },[arrivalExpiry]);
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
  const progress=journeyLocationText(data,tracking,stale,!!preview);
  const code=publicRouteCode(data?.route?.code)??publicRouteCode(record.route)??publicRouteCode(record.routeId)??"Bus route";
  const title=publicRouteName(data?.route?.name,data?.route?.id)??publicRouteName(record.route,record.routeId)??"Bus journey";
  return <section className={`bus-journey ${expanded?"bus-sheet-expanded":"bus-sheet-collapsed"}`} aria-label="Bus journey detail" aria-busy={loading}>
    <div className="bus-journey-header"><div className="bus-sheet-grip" aria-hidden="true"/><div className="bus-header-actions"><button type="button" className="bus-sheet-toggle" aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(value=>!value)}>{expanded?"Collapse journey":"Expand journey"}</button><button type="button" className="bus-close" aria-label="Close bus journey" onClick={onClose}>×</button></div>
      <p className="bus-eyebrow">Bus journey</p><h2><span aria-hidden="true">🚌</span> <span className="bus-route-badge">{code}</span></h2>{title!==code&&<p className="bus-route-title">{title}</p>}
      <p className="bus-origin">{data?.route?.origin?`From ${data.route.origin}`:"Origin unavailable"}</p><p className="bus-destination">Towards {destination(data?.route?.destination)}</p><p className="bus-meta">{data?.route?.direction!==null&&data?.route?.direction!==undefined?`Direction ${Number(data.route.direction)+1} · `:""}{record.operator}</p>
    </div>
    <div className="bus-journey-body" id={id} ref={body}>
      <div className="bus-toolbar"><span className={`bus-observation ${reliable?"bus-observation-current":""} ${stale||data?.vehicle.positionStatus==="STALE"?"bus-stale":""}`}>{!data?loading?"Loading journey…":"Timetable unavailable":!data.vehicle.realtimeAvailable?"Location unavailable":stale||data.vehicle.positionStatus==="STALE"?"Location update delayed":data.vehicle.positionStatus==="CURRENT"?"Vehicle location":"Location unavailable"}</span><button type="button" className="bus-refresh" aria-label="Refresh bus journey" disabled={loading} onClick={reload}>{loading?"Loading…":"↻ Refresh"}</button></div>
      <p className="bus-loading" role="status" aria-live="polite">{loading?data?"Refreshing journey…":"Loading journey and stops…":data?`Updated ${arrivalClock(data.retrievedAt)} MYT · ${data.stops.length} stops`:""}</p>
      {reliable&&!preview&&<button type="button" className="bus-text-button bus-locate" onClick={locateBus}>◎ Locate bus</button>}
      {selectedStop&&!selectedStop.position&&<p className="bus-fallback" role="status">Map location unavailable for {passengerName(selectedStop.name)}.</p>}
      {error&&<p className="bus-error" role="alert">Could not refresh this journey. Previously loaded information is still shown. <button type="button" disabled={loading} onClick={reload}>Retry</button></p>}
      {data&&<>
        {data.match.status!=="MATCHED"&&<p className="bus-fallback" role="status">{data.stops.length?"Journey times are unavailable.":"Journey details are unavailable for this bus."}</p>}
        {data.selectionWarning&&<p className="bus-fallback" role="status">That departure is no longer available. Showing this bus’s journey.</p>}
        {data.route&&<section className="bus-departure-section" aria-label="Bus departure options"><h3>Journey options</h3>
          {!data.vehicleDeparture&&data.route.directions.length>0&&<label className="bus-direction-select">Choose a direction<select aria-label="Bus timetable direction" value={direction??data.route.direction??""} onChange={event=>{setDirection(event.target.value||null);setDeparture(null);setPrevious(false);}}><option value="">Choose direction</option>{data.route.directions.map(value=><option key={value} value={value}>Direction {Number(value)+1}</option>)}</select></label>}
          <div className="bus-departure-options" role="group" aria-label="Select bus departure">
            {data.vehicleDeparture&&<button type="button" className={data.selectedDeparture?.key===data.vehicleDeparture.key?"bus-departure-option selected":"bus-departure-option"} aria-pressed={data.selectedDeparture?.key===data.vehicleDeparture.key} disabled={loading} onClick={()=>{setDeparture(null);setDirection(null);setPrevious(false);}}><span>{data.vehicle.realtimeAvailable?"Vehicle journey":"Scheduled journey"}</span><strong>{arrivalClock(data.vehicleDeparture.departure)}</strong><small>{sentenceCase(data.vehicleDeparture.classification)} · {boardDate(data.vehicleDeparture.departure)}</small></button>}
            {data.departures.filter(option=>option.key!==data.vehicleDeparture?.key).map(option=><button type="button" className={data.selectedDeparture?.key===option.key?"bus-departure-option selected":"bus-departure-option"} key={option.key} aria-pressed={data.selectedDeparture?.key===option.key} disabled={loading} onClick={()=>{setDeparture(option.key);setPrevious(false);}}><span>Scheduled departure</span><strong>{arrivalClock(option.departure)}</strong><small>{boardDate(option.departure)} · {destination(option.destination)}</small></button>)}
          </div>
          {!data.departures.length&&<p className="bus-caption">Departure times are unavailable for this direction. Check the service intervals below.</p>}
        </section>}
        {data.frequencies.length>0&&<section className="bus-frequency" aria-label="Bus service frequency"><h3>Service intervals</h3>{data.frequencies.slice(0,allFrequency?data.frequencies.length:1).map((window,index)=><div key={`${window.start}:${window.end}:${index}`}><strong>Every {Math.round(window.headwaySeconds/6)/10} min</strong><span>{boardDate(window.start)} · {arrivalClock(window.start)}–{arrivalClock(window.end)}{malaysiaDay(window.start)!==malaysiaDay(window.end)?` (${boardDate(window.end)})`:""} MYT</span><small>Towards {destination(window.destination)}</small></div>)}{data.frequencies.length>1&&<button type="button" className="bus-text-button" aria-expanded={allFrequency} onClick={()=>setAllFrequency(value=>!value)}>{allFrequency?"Show fewer times":"Show all times"}</button>}<p className="bus-caption">Exact departure times may vary.</p></section>}
        {stops.length>0&&<>
          <div className="bus-progress" role="status"><span aria-hidden="true">🚌</span> <strong>{progress}</strong></div>
          {nextArrival?<section className="bus-arrival-estimate" aria-label="Estimated next-stop arrival"><span className="bus-time-label bus-estimated">Estimated arrival</span><strong>Next stop: {passengerName(nextArrival.stopName)}</strong><p>{estimatedBusArrivalLabel(nextArrival,now)}</p><small>Based on recent movement. Traffic and stops may change this estimate.</small></section>:<p className="bus-caption">Arrival estimate unavailable</p>}
          {tracking?.vehicleTimestamp&&!preview&&<p className="bus-caption">{stale||tracking.source==="STALE"?"Last updated":"Location updated"} <time dateTime={tracking.vehicleTimestamp}>{stamp(tracking.vehicleTimestamp)}</time></p>}
          {!preview&&<AdherenceSummary stops={stops} summary={summary}/>}
          {reliable&&data.delay&&!preview&&<p className="bus-delay" title="The bus was still at this stop after its scheduled departure time.">At least {data.delay.minimumMinutes} min late · Updated {arrivalClock(data.delay.observedAt)}</p>}
          <div className="bus-timeline-heading"><h3>Journey stops</h3><span>{data.selectedDeparture?boardDate(data.selectedDeparture.departure):"Times unavailable"} · MYT</span></div>
          {data.selectedDeparture&&<p className="bus-time-basis">{sentenceCase(data.selectedDeparture.classification)} times</p>}
          {previousCount>0&&<button type="button" className="bus-previous-toggle" aria-expanded={previous} onClick={togglePrevious}>{previous?"Hide previous stops":"Show previous stops"} ({previousCount})</button>}
          <ol className="bus-stop-timeline" aria-label="Bus stops">{visible.map(stop=>{
            const next=reliable&&!preview&&!gpsActive&&stop.sequence===data.progress.sequence&&stop.status!=="DEPARTED";
            const first=stop.sequence===stops[0]?.sequence,primary=first?stop.departure??stop.arrival:stop.arrival??stop.departure;
            return <Fragment key={`${stop.sequence}:${stop.id}`}>
              {gpsActive&&tracking?.nextStopSequence===stop.sequence&&<GpsTimelinePosition motion={motion} tracking={tracking} previousName={stops.find(item=>item.sequence===tracking.previousPassedStopSequence)?.name} nextName={stop.name}/>}
              <li data-sequence={stop.sequence} data-stop-id={stop.id} className={`bus-stop bus-stop-${stop.status.toLowerCase()} ${selectedStop?.id===stop.id&&selectedStop.sequence===stop.sequence?"bus-stop-selected":""} ${next?"bus-stop-next":""} ${gpsActive&&tracking?.nextStopSequence===stop.sequence?"bus-gps-next":""}`}>
              <span className="bus-stop-node" aria-hidden="true">{next?"🚌":""}</span><button type="button" className="bus-stop-content bus-stop-control" aria-label={`Show ${passengerName(stop.name)} on map`} aria-pressed={selectedStop?.id===stop.id&&selectedStop.sequence===stop.sequence} onClick={event=>chooseStop(stop,event.currentTarget)}><strong>{passengerName(stop.name)}</strong><span className="bus-stop-status">{stop.status==="PASSED"||stop.status==="DEPARTED"?"Passed":stop.status==="CURRENT"?"Current location":stop.status==="UPCOMING"?next?"Next stop":"Upcoming":"Status unavailable"}</span>
                <StopTimetableAdherence assessment={stop.adherence} passed={stop.status==="PASSED"}/>
                {primary?<div className="bus-stop-times"><span>{first?stop.departure?"Departure":"Arrival":stop.arrival?"Arrival":"Departure"} <time dateTime={primary}>{arrivalClock(primary)}</time>{malaysiaDay(primary)!==malaysiaDay(data.selectedDeparture?.departure??now)&&<small> {boardDate(primary)}</small>}</span>{!first&&stop.arrival&&stop.departure&&stop.arrival!==stop.departure&&<span>Departs <time dateTime={stop.departure}>{arrivalClock(stop.departure)}</time></span>}<span className={stop.classification==="ESTIMATED"?"bus-time-label bus-estimated":"bus-time-label"}>{stop.classification?sentenceCase(stop.classification):""}</span></div>:<span className="bus-caption">{first?"Departure time unavailable":"Arrival time unavailable"}</span>}

                {!stop.position&&<small className="bus-stop-code">Map location unavailable</small>}
              </button>
            </li></Fragment>;
          })}{gpsActive&&tracking?.status==="BEYOND_LAST"&&<GpsTimelinePosition motion={motion} tracking={tracking} previousName={stops.find(item=>item.sequence===tracking.previousPassedStopSequence)?.name}/>}</ol>
        </>}
        {!stops.length&&<p className="bus-empty" role="status">{data.route?"Journey details are unavailable. Choose a scheduled departure to view its stops.":"Journey details are unavailable for this bus. Its location and any available route are still shown."}</p>}
        <div className="bus-data-note"><p>Scheduled times follow the timetable. Estimated times may vary.</p><p>Live arrival information unavailable.</p>{!data.path&&<p>Route map unavailable for this journey.</p>}<p>Last updated: {data.vehicle.reportedAt?stamp(data.vehicle.reportedAt):"Time unavailable"}</p></div>
      </>}
      <details className="bus-technical"><summary>Technical information</summary>{children}{error&&<p>{error}</p>}{data&&<>{tracking&&<GpsEvidence tracking={tracking}/>}<pre>{JSON.stringify({match:data.match,progress:data.progress,tracking:data.tracking,stops:data.stops.map(({id,sequence,adherence})=>({id,sequence,adherence})),selectionWarning:data.selectionWarning},null,2)}</pre><p>Trip match: {data.match.status} · {data.match.method??"No verified vehicle match"}</p>{data.match.routeAlias&&<p>Realtime route code verified against a unique official route name.</p>}<p>Selected trip: {data.selectedDeparture?.tripId??"Unresolved"}</p><p>Static timetable retrieved: {stamp(data.staticUpdatedAt)}</p>{safeTimetableSource(data.source)&&<a href={data.source} target="_blank" rel="noreferrer">Official GTFS timetable</a>}</>}</details>
    </div>
  </section>;
}
