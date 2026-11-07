"use client";
import { useEstimatedTrains } from "./estimated-train-context";
import { TRAIN_POSITION_EXPLANATION } from "@/lib/train-positions";
import { arrivalClock } from "@/lib/departure-board";
import { filterEstimatedTrains,type TrainMapFilters } from "@/lib/train-position-display";
export default function EstimatedTrainControls({filters,hidden,availableLines}:{filters:TrainMapFilters;hidden:string[];availableLines:string[]}){
  const state=useEstimatedTrains();
  const count=filterEstimatedTrains(state.positions,filters,hidden,availableLines).length;
  return <section className="estimated-train-controls" aria-label="Estimated train positions"><label><input type="checkbox" checked={state.visible} onChange={event=>state.setVisible(event.target.checked)}/>Estimated train positions</label><p>{TRAIN_POSITION_EXPLANATION}</p>
    {state.visible&&<><p role="status">{state.loading&&!state.payload?"Checking train service information…":count?`${count} estimated ${count===1?"train":"trains"} · Updated ${arrivalClock(new Date(state.now).toISOString())} MYT`:state.positions.length?"No estimated trains are visible with the current map settings. Check your filters and train lines.":state.error||(state.payload?.status==="AVAILABLE"?"No current train position estimates are available. Choose a station for departure times.":state.payload?.message)||"Estimated train positions unavailable."}</p><button type="button" className="secondary" disabled={state.loading} onClick={state.reload}>{state.loading?"Refreshing…":"Refresh estimates"}</button>
      {state.payload&&<details><summary>Availability by line</summary><ul>{state.payload.lines.map(line=><li key={line.lineId}><strong>{line.name}</strong> · {line.status==="READY"?`${state.positions.filter(train=>train.lineId===line.lineId).length} estimated ${state.positions.filter(train=>train.lineId===line.lineId).length===1?"train":"trains"} currently in service`:line.message}</li>)}</ul></details>}
      {state.payload&&<details><summary>Technical information</summary><pre>{JSON.stringify({asOf:state.payload.asOf,validUntil:state.payload.validUntil,source:state.payload.source,staticUpdatedAt:state.payload.staticUpdatedAt,lines:state.payload.lines},null,2)}</pre></details>}
    </>}
  </section>;
}
