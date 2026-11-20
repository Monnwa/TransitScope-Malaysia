import React, { useMemo } from "react";
import type { SimulationAlert } from "@/lib/simulation/scenarios";
import { DEFAULT_TRANSPORT_TYPES } from "@/lib/transport-type-filter";
import { safeOfficialUrl } from "@/lib/official-alert-model";
import { serviceAlertTime, serviceImpact, serviceImpactLevels, summarizeServiceAlerts, type ServiceImpactSeverity } from "@/lib/service-impact";

type ServiceNotice = SimulationAlert & { updatedAt?: string; sourceUrl?: string };
type ServiceUpdatesState = { status: "ready"; alerts: readonly ServiceNotice[]; hasAvailableAlerts?: boolean } | { status: "loading" | "error" };

const noAlerts: readonly ServiceNotice[] = [];
const filters = [...DEFAULT_TRANSPORT_TYPES.filter(mode => mode !== "Shared bike"), "Disruption", "Delay", "Normal service", "Restoration"];
const alertTime = new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" });

export default function ServiceUpdates({ state, expanded, filter, hiddenAlerts, navigationStatus, onToggle, onFilter, onSelectStation }: {
  state: ServiceUpdatesState;
  expanded: boolean;
  filter: string;
  hiddenAlerts?: { included: boolean; onChange: (included: boolean) => void };
  navigationStatus?: { id: string; message: string } | null;
  onToggle: () => void;
  onFilter: (value: string) => void;
  onSelectStation: (alert: ServiceNotice) => void;
}) {
  const alerts = state.status === "ready" ? state.alerts : noAlerts;
  const { counts, ordered } = useMemo(() => summarizeServiceAlerts(alerts), [alerts]);
  const canExpand = state.status === "ready" && (state.hasAvailableAlerts ?? alerts.length > 0);
  const open = expanded && (canExpand || Boolean(hiddenAlerts));
  const message = state.status === "loading" ? "Loading service alerts…" : state.status === "error" ? "Service alerts are unavailable." :
    !canExpand ? "No active service alerts" : !ordered.length ? "No matching service updates." : "";
  const summary = <>
    <span id="service-updates-label">Service updates</span>
    <span id="service-updates-summary">
      {state.status === "ready" && <strong className="service-updates-total">{ordered.length}</strong>}
      {message && <small role="status">{message}</small>}
      {ordered.length > 0 && <span className="service-impact-counts">
        {serviceImpactLevels.map(level => <ServiceSeverity key={level} severity={level} count={counts[level]}/>)}
      </span>}
      <small>Simulated notices</small>
    </span>
  </>;

  return <>
    {canExpand || hiddenAlerts ? <button type="button" id="service-updates" className="kpi service-updates-toggle" aria-labelledby="service-updates-label"
      aria-describedby="service-updates-summary" aria-expanded={open} aria-controls="alerts" onClick={onToggle}>
      {summary}<span className="service-updates-chevron" aria-hidden="true"/>
    </button> : <article id="service-updates" className="kpi" aria-labelledby="service-updates-label">{summary}</article>}
    <section className="panel service-alerts" id="alerts" aria-labelledby="service-alerts-title" hidden={!open}>
      {open && <>
        <div className="service-alerts-heading">
          <h2 id="service-alerts-title">Service alerts</h2>
          <label>Filter alerts <select value={filter} onChange={event => onFilter(event.target.value)}>
            <option value="All">All updates</option>
            {filters.map(option => <option key={option}>{option}</option>)}
          </select></label>
        </div>
        {hiddenAlerts && <label className="service-alert-scope"><input type="checkbox" checked={hiddenAlerts.included}
          onChange={event => hiddenAlerts.onChange(event.target.checked)}/> Include notices outside transport filters</label>}
        {!ordered.length && <p>No matching service updates.</p>}
        {ordered.length > 0 && <ul className="service-alert-list">
          {ordered.map(({ alert, severity }) => <li className="service-alert" key={alert.id}>
            <div className="service-alert-title">
              <ServiceSeverity severity={severity}/>
              <h3>{alert.title}</h3>
            </div>
            <p>{[alert.category, ...alert.modes, ...alert.routes, alert.direction && `Towards ${alert.direction}`].filter(Boolean).join(" · ")}</p>
            <p className="service-alert-description">{alert.description}</p>
            <dl className="service-alert-meta">
              {!!alert.stations.length && <div><dt>Affected stations</dt><dd>{alert.stations.join(", ")}</dd></div>}
              {serviceAlertTime(alert.updatedAt) !== undefined && <div><dt>Last updated</dt><dd><AlertTime value={alert.updatedAt}/></dd></div>}
              {serviceAlertTime(alert.startedAt) !== undefined && <div><dt>Time window</dt><dd>
                <AlertTime value={alert.startedAt}/>{alert.endsAt !== alert.startedAt && serviceAlertTime(alert.endsAt) !== undefined && <> – <AlertTime value={alert.endsAt}/></>}
              </dd></div>}
              <div><dt>Source</dt><dd>{alert.source}</dd></div>
            </dl>
            {alert.sourceUrl && safeOfficialUrl(alert.sourceUrl) && <a href={alert.sourceUrl} target="_blank" rel="noreferrer">View original announcement</a>}
            {!!alert.stations.length && <button type="button" className="link-button service-alert-action"
              onClick={() => onSelectStation(alert)}>Show affected station on map</button>}
            {navigationStatus?.id === alert.id && <p role="status">{navigationStatus.message}</p>}
          </li>)}
        </ul>}
      </>}
    </section>
  </>;
}

function ServiceSeverity({ severity, count }: { severity: ServiceImpactSeverity; count?: number }) {
  const { label, tone } = serviceImpact[severity];
  return <span className="service-impact" data-tone={tone}>
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>
      <path d="M12 9v4m0 4h.01"/>
    </svg>
    <span>{count === undefined ? label : `${count} ${label}`}</span>
  </span>;
}

function AlertTime({ value }: { value?: string | null }) {
  const time = serviceAlertTime(value);
  if (time === undefined) return null;
  return <time dateTime={value ?? undefined}>{alertTime.format(time)} MYT</time>;
}
