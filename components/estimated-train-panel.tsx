"use client";
import { useEstimatedTrains } from "./estimated-train-context";
import { arrivalClock,arrivalCountdown } from "@/lib/departure-board";
import { TRAIN_POSITION_EXPLANATION } from "@/lib/train-positions";
import type { ReactNode } from "react";
export default function EstimatedTrainPanel({fallback}:{fallback:ReactNode}){
  const state=useEstimatedTrains(),train=state.positions.find(train=>train.id===state.selectedId);
  if(!state.selectedId)return fallback;
  if(!train)return <section className="estimated-train-panel" aria-label="Estimated train information"><button type="button" className="bus-close" aria-label="Close estimated train" onClick={()=>state.setSelectedId(null)}>×</button><h2>Estimated position unavailable</h2><p>Service information has changed. Choose a station for departure times.</p></section>;
  const countdown=train.nextArrival!==null?arrivalCountdown(train.nextArrival,state.now):null;
  return <section className="estimated-train-panel" aria-label="Estimated train information"><div className="estimated-train-header"><button type="button" className="bus-close" aria-label="Close estimated train" onClick={()=>state.setSelectedId(null)}>×</button><span className="estimated-status">Estimated</span><h2 style={{borderLeftColor:train.colour}}>{train.lineName}</h2><p>Towards {train.destination}</p></div><div className="estimated-train-body">
    {train.nearStation&&<p>Estimated near {train.nearStation.name}</p>}
    <dl><dt>Previous station</dt><dd>{train.previousStation?.name??"Starting station"}</dd><dt>Next station</dt><dd>{train.nextStation?.name??"Final station"}</dd>{countdown&&train.nextArrival!==null&&<><dt>Estimated arrival at next station</dt><dd>About {countdown} · {arrivalClock(new Date(train.nextArrival).toISOString())}</dd></>}<dt>Position</dt><dd>Estimated</dd><dt>Last updated</dt><dd>{arrivalClock(train.updatedAt)} MYT</dd></dl>
    <p className="estimated-train-note">{TRAIN_POSITION_EXPLANATION}</p><details><summary>Technical information</summary><pre>{JSON.stringify(train,null,2)}</pre></details>
  </div></section>;
}
