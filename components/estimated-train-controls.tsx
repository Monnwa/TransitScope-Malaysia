"use client";

import { arrivalClock } from "@/lib/departure-board";
import { timestamp } from "@/lib/simulation/clock";
import type { SimulatedTrain } from "@/lib/simulation/vehicles";
import type { RailLine } from "@/lib/rail-model";

export default function EstimatedTrainControls({ enabled, onToggle, now, count, trains, lines, onRefresh }: {
  enabled: boolean; onToggle: (enabled: boolean) => void; now: number; count: number;
  trains: SimulatedTrain[]; lines: RailLine[]; onRefresh: () => void;
}) {
  return <section className="estimated-train-controls" aria-label="Simulated train positions">
    <label><input type="checkbox" checked={enabled} onChange={event => onToggle(event.target.checked)}/>Show simulated train positions</label>
    {enabled && <>
      <p role="status">{count} simulated {count === 1 ? "train" : "trains"} displayed · {arrivalClock(timestamp(now))} MYT</p>
      <button type="button" className="secondary" onClick={onRefresh}>Refresh train positions</button>
      <details><summary>Availability by line</summary><ul>{lines.map(line => <li key={line.id}>{line.name} · {trains.filter(train => train.lineId === line.id).length}</li>)}</ul></details>
    </>}
  </section>;
}
