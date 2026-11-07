"use client";
import { useId, useState } from "react";
import type { TrainArrival } from "@/lib/train-arrivals";
import { arrivalClock, arrivalCountdown, boardDate, malaysiaDay } from "@/lib/departure-board";
import { rapidRailMeta } from "@/lib/rail-model";
import { platformLabel,sentenceCase } from "./passenger-copy";
const destination = (value?:string) => value ? /^from\s+.+?\s+to\s+(.+)$/i.exec(value)?.[1] ?? value : "Destination not provided";
const groupKey = (item:TrainArrival) => `${item.source}|${item.routeId}|${item.direction??""}|${item.destination??""}`;
export default function TrainArrivalRows({arrivals,now}:{arrivals:TrainArrival[];now:number}) {
  const [expanded,setExpanded]=useState(false);const id=useId();
  const visible=arrivals.slice(0,expanded?10:5);
  // Contiguous direction groups retain global chronological order, rather than
  // moving a later train above an earlier train from another direction.
  const groups: {first:TrainArrival;rows:TrainArrival[]}[]=[];
  for(const item of visible){const last=groups[groups.length-1];if(last&&groupKey(last.first)===groupKey(item))last.rows.push(item);else groups.push({first:item,rows:[item]});}
  const estimated=arrivals.some(item=>item.classification==="ESTIMATED");
  return <section className="train-arrivals" aria-label="Upcoming train arrivals">
    <div className="train-arrival-caption"><span>Next trains</span><span>Arrival · MYT</span></div>
    <div id={id}>{groups.map(({first:group,rows},index)=><div className="train-direction-group" key={`${groupKey(group)}:${index}`}>
      {groups.length>1&&rows.length>1&&<h4 style={{borderLeftColor:rapidRailMeta[group.routeId]?.colour??"#1666d8"}}>{group.routeName} · {destination(group.destination)}</h4>}
      <ul aria-label={`${group.routeName} towards ${destination(group.destination)}`}>
        {rows.map(item=><li className="train-arrival-row" key={`${item.routeId}:${item.stopId}:${item.arrivalTime}:${item.direction}`}>
          <div className="train-arrival-service"><span className="train-line-badge" style={{borderLeftColor:rapidRailMeta[item.routeId]?.colour??"#1666d8"}}><span aria-hidden="true">🚆</span> {item.routeName}</span><strong>Towards {destination(item.destination)}</strong><span className="board-service-meta">{platformLabel(item.platform)}</span></div>
          <div className="train-arrival-time"><time dateTime={item.arrivalTime}>{arrivalClock(item.arrivalTime)}</time>{malaysiaDay(item.arrivalTime)!==malaysiaDay(now)&&<span className="board-date">{boardDate(item.arrivalTime)}</span>}<span className="train-countdown" aria-label={`${item.classification.toLowerCase()} arrival in ${arrivalCountdown(item.arrivalTimestamp,now)}`}>{item.classification==="ESTIMATED"?"About ":""}{arrivalCountdown(item.arrivalTimestamp,now)}</span><span className={item.classification==="ESTIMATED"?"board-type train-estimated":"board-type"} title={item.classification==="ESTIMATED"?"Estimated from published schedules. Actual train arrival may differ.":"Scheduled arrival from the published timetable."}>{sentenceCase(item.classification)}</span></div>
        </li>)}
      </ul>
    </div>)}</div>
    {arrivals.length>5&&<button type="button" className="board-expand" aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(value=>!value)}>{expanded?"Show fewer trains":"Show all arrivals"}{!expanded&&` (${arrivals.length})`}</button>}
    {estimated&&<p className="train-estimate-note">Estimated arrivals are based on published schedules. Actual train arrival may differ.</p>}
  </section>;
}
