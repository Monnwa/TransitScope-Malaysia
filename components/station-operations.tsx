"use client";

import "@/app/station-operations.css";
import React, { useId, useState } from "react";
import { getStationOperations, stationServiceLabel } from "@/lib/station-operations";
import type { AlertPayload } from "@/lib/official-alert-model";
import type { Record as TransitRecord } from "@/lib/transit-data";

const stationTime = new Intl.DateTimeFormat("en-MY", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur",
});
const dateLabel = (value: string) => stationTime.format(new Date(value)) + " MYT";

export default function StationOperations({ record, payload, refreshFailed }: {
  record: TransitRecord;
  payload: AlertPayload | null;
  refreshFailed: boolean;
}) {
  const [serviceId, selectService] = useState("");
  const [direction, selectDirection] = useState("");
  const titleId = useId();
  const serviceFilterId = useId();
  const directionFilterId = useId();
  const services = getStationOperations(record, payload, refreshFailed, Date.now());
  const selected = services.find(service => service.id === serviceId);
  if (!services.length) return null;
  const visible = selected ? [selected] : services;

  return <section className="station-operations" aria-labelledby={titleId}>
    <div className="station-ops-heading">
      <h3 id={titleId}>Station operations</h3>
      {services.length > 1 && <div>
        <label htmlFor={serviceFilterId} className="station-ops-sr-only">Service</label>
        <select id={serviceFilterId} value={selected?.id ?? ""} onChange={event => { selectService(event.target.value); selectDirection(""); }}>
          <option value="">All services</option>
          {services.map(service => <option key={service.id} value={service.id}>{service.label}</option>)}
        </select>
      </div>}
    </div>
    {!!selected?.directions?.length && <div className="station-ops-direction">
      <label htmlFor={directionFilterId}>Direction</label>
      <select id={directionFilterId} value={direction} onChange={event => selectDirection(event.target.value)}>
        <option value="">Both directions</option>
        {selected.directions.map(destination => <option key={destination} value={destination}>{destination}</option>)}
      </select>
    </div>}
    {!payload && !refreshFailed && <p className="station-ops-note" role="status">Checking operator notices…</p>}
    {refreshFailed && <p className="station-ops-note" role="status">Updates could not be refreshed. Check the operator for current information.</p>}
    <ul className="station-ops-services">
      {visible.map(service => {
        const notices = service.notices.filter(notice => !direction || !notice.direction || notice.direction === direction);
        const label = stationServiceLabel(service, notices);
        const current = notices.some(notice => notice.current);
        return <li className="station-ops-service" key={service.id}>
          <h4>{service.label}</h4>
          <span className={current || service.networkStatus === "DISRUPTED" ? "station-ops-state attention" : "station-ops-state"}>{label}</span>
          {notices.length > 0 && <ul className="station-ops-notices">
            {notices.slice(0, 3).map(({ alert, scope, direction: affectedDirection, alternative, current: isCurrent }) =>
              <li key={alert.id}>
                <a href={alert.sourceUrl} target="_blank" rel="noreferrer">{alert.title}</a>
                <small>{scope} · {affectedDirection ? "Towards " + affectedDirection : "Direction not specified"}</small>
                <small>{alert.publishedAt ? <time dateTime={alert.publishedAt}>{dateLabel(alert.publishedAt)}</time> : "Publication date unavailable"}
                  {!isCurrent && " · Current status unconfirmed"}</small>
                {alert.category === "SCHEDULE_CHANGE" && <p className="station-ops-note">{alert.description}</p>}
                {isCurrent && alternative && <p className="station-ops-alternative"><strong>Alternative in notice</strong>{alternative}</p>}
              </li>)}
          </ul>}
          <div className="station-ops-source">
            <a href={service.official.href} target="_blank" rel="noreferrer">{service.official.label}</a>
            {service.lastChecked && <time dateTime={service.lastChecked}>Checked {dateLabel(service.lastChecked)}</time>}
          </div>
        </li>;
      })}
    </ul>
  </section>;
}
