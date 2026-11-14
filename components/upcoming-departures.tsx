"use client";

import "@/app/departure-board.css";
import { useId, useMemo, useState, type ReactNode } from "react";
import { arrivalClock, arrivalCountdown, boardDate, malaysiaDay } from "@/lib/departure-board";
import { SIMULATED, timestamp } from "@/lib/simulation/clock";
import { railNetwork, stationServices } from "@/lib/simulation/network";
import { stationArrivals } from "@/lib/simulation/vehicles";
import type { Record as TransitRecord } from "@/lib/transit-data";

export default function UpcomingDepartures({ record, operations, now, onRefresh }: {
  record: TransitRecord; operations?: ReactNode; now: number; onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [routeId, setRouteId] = useState("");
  const listId = useId();
  const services = (record.stopRefs ?? []).flatMap(ref => {
    const service = stationServices.get(ref);
    return service ? [{ ref, route: service.route }] : [];
  });
  const routes = [...new Map(services.map(({ route }) => [route.id, route.name]))];
  const arrivals = useMemo(() => stationArrivals((record.stopRefs ?? []).filter(ref =>
    !routeId || stationServices.get(ref)?.route.id === routeId), now), [record.stopRefs, routeId, now]);
  const visible = arrivals.slice(0, expanded ? arrivals.length : 5);
  return <section className="station-departure-board">
    <div className="board-station-header">
      <p className="board-eyebrow">{record.mode === "Bus" ? "BUS STOP" : record.interchange ? "INTERCHANGE" : "TRAIN STATION"}</p>
      <h2>{record.name}</h2>
      <div className="board-line-list">{(record.railLines ?? []).map((id, index) => <span key={id} className="board-line-chip" style={{ borderLeftColor: railNetwork.lines.find(line => line.id === id)?.colour }}>{record.lineNames?.[index] ?? id}</span>)}</div>
      <span className="board-status">{SIMULATED}</span>
    </div>
    {operations}
    <section className="board-upcoming" aria-label="Upcoming Departures">
      <div className="board-section-heading"><h3>{record.mode === "Bus" ? "Upcoming buses" : "Upcoming trains"}</h3>
        <button type="button" className="board-refresh" aria-label="Refresh departures" onClick={onRefresh}>↻ Refresh</button>
      </div>
      {routes.length > 1 && <label>Service <select value={routeId} onChange={event => setRouteId(event.target.value)}><option value="">All lines</option>
        {routes.map(([id, name]) => <option value={id} key={id}>{name}</option>)}
      </select></label>}
      <div className="board-announcement">{arrivals.length} upcoming simulated services · MYT</div>
      <div className="board-departure-list"><ul id={listId} aria-label="Simulated arrivals">{visible.map(arrival => {
        const time = timestamp(arrival.arrivalTimestamp);
        return <li key={arrival.tripId} className="board-departure" style={{ borderLeftColor: railNetwork.lines.find(line => line.id === arrival.routeId)?.colour }}>
          <div className="board-service"><span className="board-route">{arrival.routeName}</span><strong className="board-destination">Towards {arrival.destination}</strong>
            <span className="board-service-meta">{arrival.mode === "Bus" ? "Direction" : "Platform"} {arrival.platform} · {arrival.vehicleId}</span></div>
          <div className="board-time"><time dateTime={time}>{arrivalClock(time)}</time>
            {malaysiaDay(now) !== malaysiaDay(time) && <small className="board-date">{boardDate(time)}</small>}
            <span className="train-countdown">{arrivalCountdown(arrival.arrivalTimestamp, now)}</span><small className="board-type">{SIMULATED}</small></div>
        </li>;
      })}</ul></div>
      {arrivals.length > 5 && <button type="button" className="board-expand" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}>
        {expanded ? "Show fewer services" : "Show all services"}
      </button>}
      {!visible.length && <p className="board-empty">No upcoming services match this selection.</p>}
    </section>
  </section>;
}
