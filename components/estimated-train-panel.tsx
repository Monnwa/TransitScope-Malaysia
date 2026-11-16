"use client";

import { arrivalClock, arrivalCountdown } from "@/lib/departure-board";
import { SIMULATED, timestamp } from "@/lib/simulation/clock";
import type { SimulatedTrain } from "@/lib/simulation/vehicles";

export default function EstimatedTrainPanel({ train, now, onClose }: { train: SimulatedTrain; now: number; onClose: () => void }) {
  return <section className="estimated-train-panel" aria-label="Simulated train information">
    <div className="estimated-train-header"><button type="button" className="bus-close" aria-label="Close simulated train" onClick={onClose}>×</button>
      <span className="estimated-status">{SIMULATED}</span><h2 style={{ borderLeftColor: train.colour }}>{train.lineName}</h2>
      <p>{train.name} · Towards {train.destination}</p>
    </div>
    <div className="estimated-train-body">
      {train.nearStation && <p>At {train.nearStation.name}</p>}
      <dl><dt>Previous station</dt><dd>{train.previousStation?.name ?? "Starting station"}</dd>
        <dt>Next station</dt><dd>{train.nextStation?.name ?? "Final station"}</dd>
        {train.nextArrival !== null && <><dt>Simulated arrival</dt><dd>{arrivalCountdown(train.nextArrival, now)} · {arrivalClock(timestamp(train.nextArrival))} MYT</dd></>}
        <dt>Last updated</dt><dd>{arrivalClock(train.updatedAt)} MYT</dd>
      </dl>
      <details><summary>Technical information</summary><pre>{JSON.stringify(train, null, 2)}</pre></details>
    </div>
  </section>;
}
