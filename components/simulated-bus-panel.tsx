"use client";

import "@/app/bus-journey.css";
import { useEffect, useId, useState, type ReactNode } from "react";
import { arrivalClock, arrivalCountdown } from "@/lib/departure-board";
import { SIMULATED, timestamp } from "@/lib/simulation/clock";
import type { SimulatedBusJourney } from "@/lib/simulation/vehicles";
import { stopStatusLabel } from "./passenger-copy";

export type JourneyNavigation = { journeyId: string; action: number; sequence?: number };

export default function SimulatedBusPanel({ journey, navigation, onNavigate, onClose, onRefresh, onPreview, children }: {
  journey: SimulatedBusJourney;
  navigation: JourneyNavigation | null;
  onNavigate: (navigation: JourneyNavigation) => void;
  onClose: () => void;
  onRefresh: () => void;
  onPreview: (preview: { vehicleId: string; start: number } | null) => void;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showPassed, setShowPassed] = useState(false);
  const panelId = useId();
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) onClose(); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  const selected = navigation?.journeyId === journey.journeyId ? navigation.sequence : undefined;
  const passed = journey.stops.filter(stop => stop.status === "PASSED");
  const stops = journey.stops.filter(stop => showPassed || stop.status !== "PASSED" || stop.sequence === passed.at(-1)?.sequence || stop.sequence === selected);
  const navigate = (sequence?: number) => onNavigate({ journeyId: journey.journeyId, sequence, action: (navigation?.action ?? 0) + 1 });

  return <section className={`bus-journey ${expanded ? "bus-sheet-expanded" : "bus-sheet-collapsed"}`} aria-label="Bus journey detail">
    <div className="bus-journey-header">
      <div className="bus-sheet-grip" aria-hidden="true"/>
      <div className="bus-header-actions">
        <button className="bus-sheet-toggle" type="button" aria-controls={panelId} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Collapse journey" : "Expand journey"}</button>
        <button className="bus-close" type="button" aria-label="Close bus journey" onClick={onClose}>×</button>
      </div>
      <p className="bus-eyebrow">{SIMULATED} BUS JOURNEY</p>
      <h2><span aria-hidden="true">🚌</span> <span className="bus-route-badge">{journey.routeId}</span> {journey.vehicle.name}</h2>
      <p className="bus-origin">From {journey.origin}</p><p className="bus-destination">Towards {journey.destination}</p>
      <p className="bus-meta">Direction {journey.direction + 1} · {journey.vehicle.operator}</p>
    </div>
    <div className="bus-journey-body" id={panelId}>
      <div className="bus-toolbar"><span className="bus-observation">{journey.vehicle.status}</span>
        <button className="bus-refresh" type="button" aria-label="Refresh bus journey" onClick={onRefresh}>↻ Refresh</button>
      </div>
      <button className="bus-text-button bus-locate" type="button" onClick={() => { onPreview(null); onNavigate({ journeyId: journey.currentJourneyId, action: (navigation?.action ?? 0) + 1 }); }}>◎ Locate bus</button>
      <section className="bus-departure-section" aria-label="Bus departure options">
        <h3>Journey options</h3>
        <div className="bus-departure-options" role="group" aria-label="Select bus departure">
          <button type="button" className={`bus-departure-option${journey.isPreview ? "" : " selected"}`} aria-pressed={!journey.isPreview} onClick={() => onPreview(null)}>
            <span>Vehicle journey</span><strong>{arrivalClock(journey.currentDeparture)}</strong><small>{SIMULATED}</small>
          </button>
          {journey.departures.slice(0, 4).map(option => <button type="button" key={option.tripId}
            className={`bus-departure-option${journey.journeyId === option.tripId ? " selected" : ""}`} aria-pressed={journey.journeyId === option.tripId}
            onClick={() => onPreview({ vehicleId: option.vehicleId, start: option.arrivalTimestamp })}>
            <span>Upcoming departure</span><strong>{arrivalClock(timestamp(option.departureTimestamp))}</strong><small>{option.destination}</small>
          </button>)}
        </div>
      </section>
      {!journey.isPreview && <>
        <div className="bus-progress" aria-label="Journey progress">
          <progress value={journey.progress} max={1}/><strong>{Math.round(journey.progress * 100)}%</strong><span>{journey.timing}{journey.offsetMinutes ? ` · ${Math.abs(journey.offsetMinutes)} min` : ""}</span>
        </div>
        {passed.length > 0 && <p className="bus-adherence-summary" aria-label="Timetable adherence summary">{passed.length} {passed.length === 1 ? "stop passed" : "stops passed"} · {journey.timing}</p>}
        {journey.nextArrival !== null && <section className="bus-arrival-estimate" aria-label="Simulated next-stop arrival">
          <span className="bus-time-label">{SIMULATED} ETA</span><strong>Next stop: {journey.nextStop}</strong>
          <p>{arrivalCountdown(journey.nextArrival, journey.now)} · {arrivalClock(timestamp(journey.nextArrival))} MYT</p>
        </section>}
      </>}
      <div className="bus-timeline-heading"><h3>Journey stops</h3><span>MYT</span></div>
      {passed.length > 1 && <button className="bus-previous-toggle" aria-expanded={showPassed} onClick={() => setShowPassed(value => !value)}>{showPassed ? "Hide previous stops" : "Show previous stops"} ({passed.length - 1})</button>}
      <ol className="bus-stop-timeline" aria-label="Bus stops">
        {stops.map(stop => <li key={stop.id} className={`bus-stop bus-stop-${stop.status.toLowerCase()}${stop.sequence === selected ? " bus-stop-selected" : ""}`}
          data-sequence={stop.sequence} data-stop-id={stop.id} data-stop-status={stop.status}>
          <span className="bus-stop-node" aria-hidden="true"/>
          <button type="button" className="bus-stop-control bus-stop-content" aria-pressed={stop.sequence === selected} onClick={() => navigate(stop.sequence)}>
            <strong>{stop.name}</strong><span className="bus-stop-status">{stopStatusLabel(stop.status)}</span>
            <span className="bus-stop-times">Arrival <time dateTime={stop.arrival}>{arrivalClock(stop.arrival)}</time> · Departure <time dateTime={stop.departure}>{arrivalClock(stop.departure)}</time></span>
            <small>Timetable {arrivalClock(stop.scheduledDeparture)}{stop.status === "PASSED" && ` · ${journey.timing}`}</small>
          </button>
        </li>)}
      </ol>
      <details className="bus-technical"><summary>Technical information</summary>{children}</details>
    </div>
  </section>;
}
