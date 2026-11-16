"use client";
import L from "leaflet";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { CircleMarker, Marker, Polyline, Popup, Tooltip, useMap } from "react-leaflet";
import type { RouteAnimator } from "@/lib/route-animation";
import { splitRoutePath, type GeoPoint } from "@/lib/route-projection";
import { mapStopAnchor } from "@/lib/journey-stop-selection";
import type { BusMapJourney } from "./bus-journey-panel";
import { arrivalClock } from "@/lib/departure-board";
import { passengerName,publicRouteName,stopStatusLabel } from "./passenger-copy";

export function MovingVehicle({position,motion,icon,title,selected,stale,onClick,children}:{position:GeoPoint;motion?:RouteAnimator;icon:L.DivIcon;title:string;selected:boolean;stale:boolean;onClick:()=>void;children:ReactNode}){
  const marker=useRef<L.Marker>(null),frame=motion?.getFrame();
  useLayoutEffect(()=>{if(!motion)return;return motion.subscribe(frame=>{const layer=marker.current;if(!layer||!frame)return;layer.setLatLng(frame.point);const element=layer.getElement();if(element){element.dataset.distance=String(frame.distanceM);element.dataset.playing=String(frame.playing);element.dataset.stale=String(frame.stale);element.dataset.latitude=String(frame.point[0]);element.dataset.longitude=String(frame.point[1]);element.dataset.observedAt=String(frame.observedAt);const glyph=element.querySelector<HTMLElement>(".vehicle-glyph");if(glyph)glyph.style.transform=`rotate(${frame.heading-90}deg)`;}});},[motion,icon]);
  return <Marker ref={marker} title={title} position={frame?.point??position} icon={icon} opacity={stale||frame?.stale? .5:1} zIndexOffset={selected?1100:0} eventHandlers={{click:onClick}}>{children}</Marker>;
}
export function MovingRoute({path,motion,fallback}:{path:GeoPoint[];motion?:RouteAnimator;fallback:{completed:GeoPoint[];remaining:GeoPoint[]}}){
  const completed=useRef<L.Polyline>(null),remaining=useRef<L.Polyline>(null);
  useLayoutEffect(()=>{if(!motion)return;let last=-Infinity;return motion.subscribe(frame=>{if(!frame||performance.now()-last<66&&frame.playing)return;last=performance.now();const parts=splitRoutePath(path,frame.segment,frame.point);if(!parts)return;completed.current?.setLatLngs(parts.completed);remaining.current?.setLatLngs(parts.remaining);});},[path,motion]);
  const frame=motion?.getFrame(),parts=(frame?splitRoutePath(path,frame.segment,frame.point):null)??fallback;
  return <><Polyline ref={completed} className="gps-route-completed" positions={parts.completed} pathOptions={{color:"#65758b",weight:6,opacity:.95}}><Tooltip>Route behind the bus</Tooltip></Polyline><Polyline ref={remaining} className="gps-route-remaining" positions={parts.remaining} pathOptions={{color:"#1666d8",weight:6,opacity:1}}><Tooltip>Route ahead</Tooltip></Polyline></>;
}
export function JourneyMapNavigation({journey}:{journey?:BusMapJourney|null}){
  const map=useMap(),last=useRef(""),target=useRef<GeoPoint|null>(null);
  useEffect(()=>{
    const stop=journey?.selectedStop,request=stop?`stop:${stop.key}:${journey?.navigation}`:journey?.locate?`bus:${journey.vehicleId}:${journey.locate}`:"";
    if(!request||request===last.current)return;last.current=request;
    const point=stop?.position??(!stop?journey?.motion?.getFrame()?.point??journey?.tracking?.position??journey?.lastSeen?.position:null);if(!point){target.current=null;delete map.getContainer().dataset.focusedStopId;delete map.getContainer().dataset.focusedSequence;return;}target.current=point;
    const container=map.getContainer(),rect=container.getBoundingClientRect();
    // This is an explicit navigation action; GPS refreshes never scroll or follow.
    if(rect.bottom<80||rect.top>window.innerHeight*.25){container.scrollIntoView({block:window.innerWidth<=720?"start":"center",behavior:"instant"});if(window.innerWidth<=720)window.scrollBy({top:-12,behavior:"instant"});}
    const box=container.getBoundingClientRect(),obstructions=Array.from(document.querySelectorAll(".bus-journey,header")).map(element=>element.getBoundingClientRect());
    const anchor=mapStopAnchor(box,{width:window.innerWidth,height:window.innerHeight},obstructions),size=map.getSize(),zoom=map.getZoom()>=16&&map.getZoom()<=18?Math.round(map.getZoom()):17;
    const center=map.unproject(map.project(point,zoom).add(L.point(size.x/2-anchor.x,size.y/2-anchor.y)),zoom);
    container.dataset.focusedStopId=stop?.id??"";container.dataset.focusedSequence=stop?String(stop.sequence):"";container.dataset.focusedLatitude=String(point[0]);container.dataset.focusedLongitude=String(point[1]);container.dataset.focusedZoom=String(zoom);
    map.stop();if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)map.setView(center,zoom,{animate:false});else map.flyTo(center,zoom,{duration:.5});
  },[journey?.selectedStop?.key,journey?.navigation,journey?.locate,journey?.vehicleId,map]);
  useEffect(()=>{if(!journey?.selectedStop){target.current=null;if(!journey?.locate){delete map.getContainer().dataset.focusedStopId;delete map.getContainer().dataset.focusedSequence;}}},[journey?.selectedStop?.key,journey?.locate,map]);
  useEffect(()=>{
    if(!journey?.selectedStop?.position)return;
    let previousSize="";
    const keepVisible=()=>{const sheet=document.querySelector(".bus-journey")?.getBoundingClientRect(),sizeKey=`${window.innerWidth}:${window.innerHeight}:${sheet?.width}:${sheet?.height}`;if(!previousSize){previousSize=sizeKey;return;}if(sizeKey===previousSize)return;previousSize=sizeKey;const point=target.current;if(!point)return;const container=map.getContainer(),box=container.getBoundingClientRect(),obstructions=Array.from(document.querySelectorAll(".bus-journey,header")).map(element=>element.getBoundingClientRect()),anchor=mapStopAnchor(box,{width:window.innerWidth,height:window.innerHeight},obstructions),pixel=map.latLngToContainerPoint(point);
      if(Math.abs(pixel.x-anchor.x)<anchor.width/2-18&&Math.abs(pixel.y-anchor.y)<Math.max(12,anchor.height/4-18))return;
      const size=map.getSize(),zoom=map.getZoom()>=16&&map.getZoom()<=18?map.getZoom():17;
      const center=map.unproject(map.project(point,zoom).add(L.point(size.x/2-anchor.x,size.y/2-anchor.y)),zoom);map.setView(center,zoom,{animate:false});
    };
    const observer=new ResizeObserver(keepVisible),sheet=document.querySelector(".bus-journey");if(sheet)observer.observe(sheet);window.addEventListener("resize",keepVisible);return()=>{observer.disconnect();window.removeEventListener("resize",keepVisible);};
  },[journey?.selectedStop?.key,map]);
  return null;
}
export function JourneyStopMarker({journey}:{journey:BusMapJourney}){
  const stop=journey.selectedStop,popup=useRef<L.Popup>(null),map=useMap();
  useEffect(()=>{if(stop?.position)popup.current?.openOn(map);},[stop?.key,journey.navigation,map]);
  if(!stop?.position)return null;
  return <><CircleMarker className="journey-stop-selected" center={stop.position} radius={11} pane="markerPane" pathOptions={{color:"#10243e",weight:4,fillColor:"#f2c500",fillOpacity:1}} eventHandlers={{click:()=>popup.current?.openOn(map)}}><Tooltip>{passengerName(stop.name)} · Selected stop</Tooltip></CircleMarker><Popup ref={popup} key={stop.key} position={stop.position} autoPan={false} closeOnClick={false} maxWidth={245} minWidth={170}><div className="journey-stop-popup" role="status"><strong>{passengerName(stop.name)}</strong><span>{publicRouteName(stop.routeName)?`Route ${stop.routeName}`:"Route unavailable"} · {stop.classification}</span><span>Arrival {stop.arrival?arrivalClock(stop.arrival):"Time unavailable"} · Departure {stop.departure?arrivalClock(stop.departure):"Time unavailable"} MYT</span><span>{stopStatusLabel(stop.status)}</span></div></Popup></>;
}
