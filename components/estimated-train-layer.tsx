"use client";
import L from "leaflet";
import { useEffect,useMemo,useState } from "react";
import { Marker,Popup,Tooltip,useMap,useMapEvents } from "react-leaflet";
import { useEstimatedTrains } from "./estimated-train-context";
import { filterEstimatedTrains,groupEstimatedTrains,type TrainMapFilters } from "@/lib/train-position-display";
import { mapStopAnchor } from "@/lib/journey-stop-selection";
const icon=(colour:string,count:number,selected:boolean)=>L.divIcon({className:`estimated-train-icon ${selected?"estimated-train-selected":""}`,html:`<span style="--train-colour:${colour}" aria-hidden="true">🚆<b>${count>1?count:"~"}</b></span>`,iconSize:[30,34],iconAnchor:[15,17]});
export default function EstimatedTrainLayer({filters,hidden,availableLines,highlighted,onSelect,onHighlight}:{filters:TrainMapFilters;hidden:string[];availableLines:string[];highlighted:string[];onSelect:()=>void;onHighlight:(id:string)=>void}){
  const state=useEstimatedTrains(),map=useMap(),[zoom,setZoom]=useState(map.getZoom());useMapEvents({zoomend:()=>setZoom(map.getZoom())});
  const trains=useMemo(()=>filterEstimatedTrains(state.positions,filters,hidden,availableLines),[state.positions,filters,hidden,availableLines]);
  const groups=useMemo(()=>groupEstimatedTrains(trains,train=>map.latLngToContainerPoint(train.position),state.selectedId),[trains,map,zoom,state.selectedId]);
  useEffect(()=>{if(state.selectedId&&state.positions.some(train=>train.id===state.selectedId)&&!trains.some(train=>train.id===state.selectedId))state.setSelectedId(null);},[state.selectedId,state.positions,trains,state.setSelectedId]);
  useEffect(()=>{
    const train=trains.find(train=>train.id===state.selectedId);if(!train)return;
    const container=map.getContainer(),before=container.getBoundingClientRect();if(before.bottom<80||before.top>window.innerHeight*.3){container.scrollIntoView({block:window.innerWidth<=720?"start":"center",behavior:"instant"});if(window.innerWidth<=720)window.scrollBy({top:-12,behavior:"instant"});}
    const box=container.getBoundingClientRect(),obstructions=Array.from(document.querySelectorAll(".estimated-train-panel,header")).map(element=>element.getBoundingClientRect()),anchor=mapStopAnchor(box,{width:window.innerWidth,height:window.innerHeight},obstructions),size=map.getSize(),targetZoom=Math.max(13,Math.min(16,Math.round(map.getZoom())));
    map.setView(map.unproject(map.project(train.position,targetZoom).add(L.point(size.x/2-anchor.x,size.y/2-anchor.y)),targetZoom),targetZoom,{animate:false});
  },[state.selectedId,map]);
  const select=(id:string,lineId:string)=>{state.setSelectedId(id);onSelect();onHighlight(lineId);};
  return <>{groups.map(group=>{const selected=group.members.some(train=>train.id===state.selectedId),train=group.anchor,title=group.members.length>1?`${group.members.length} estimated trains nearby`:`Estimated ${train.lineName} towards ${train.destination}`,dimmed=highlighted.length>0&&!group.members.some(member=>highlighted.includes(member.lineId));
    const describe=(layer:L.Marker|null)=>{const element=layer?.getElement();if(element){element.dataset.trainLine=train.lineId;element.dataset.trainDirection=train.direction;element.dataset.latitude=String(train.position[0]);element.dataset.longitude=String(train.position[1]);element.dataset.trainCount=String(group.members.length);element.dataset.trainStatus="ESTIMATED";}};
    return <Marker key={group.members.map(train=>train.id).sort().join("|")} title={title} position={train.position} icon={icon(train.colour,group.members.length,selected)} opacity={dimmed ? .4 : 1} zIndexOffset={selected?1300:800} eventHandlers={{add:event=>describe(event.target as L.Marker),click:()=>{if(group.members.length===1)select(train.id,train.lineId);}}} ref={describe}>
      <Tooltip>{title} · Estimated</Tooltip><Popup autoPan={false} maxHeight={180} maxWidth={270}><div className="estimated-train-popup"><strong>Estimated train {group.members.length>1?"positions":"position"}</strong>{group.members.map((member,i)=><button type="button" key={member.id} onClick={()=>select(member.id,member.lineId)}>{group.members.length>1?`Estimate ${i+1} · `:""}{member.lineName}<br/>Towards {member.destination}{member.nextStation&&<><br/>Next: {member.nextStation.name}</>}</button>)}</div></Popup>
    </Marker>;
  })}</>;
}
