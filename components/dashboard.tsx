"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { filterRecords, type Mode, type Record as TransitRecord, type Status } from "@/lib/transit-data";
import { simulationSnapshot } from "@/lib/simulation";
import { EPOCH, MINUTE, SIMULATED, simulationTime } from "@/lib/simulation/clock";
import { busRoutes, busStops, railNetwork } from "@/lib/simulation/network";
import { linkBikeSnapshot } from "@/lib/simulation/scenarios";
import { busJourney } from "@/lib/simulation/vehicles";
import { passengerName, resultCountLabel } from "./passenger-copy";
import SimulatedBusPanel, { type JourneyNavigation } from "./simulated-bus-panel";
import UpcomingDepartures from "./upcoming-departures";
import StationOperations from "./station-operations";
import EstimatedTrainPanel from "./estimated-train-panel";
import { BusCameraProvider } from "./bus-camera-context";
import { buildStationSearchIndex, findStations, normaliseSearchText, resolveExactStation, type SearchEntity } from "@/lib/station-search";
import { adaptLinkBikeStation, type MicromobilityResponse } from "@/lib/micromobility";
import { busStopSearchResponseSchema, type SearchBusStop } from "@/lib/bus-stop-search";
import useStationSearch from "./use-station-search";
import StationSearchInput from "./station-search-input";
import { DEFAULT_TRANSPORT_TYPES, transportTypeFilter } from "@/lib/transport-type-filter";

const TransitMap = dynamic(() => import("./transit-map"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map controls…</div>,
});

const colours: Record<Mode, string> = { Bus: "#2563eb", MRT: "#7c3aed", LRT: "#ea580c", Monorail: "#db2777", KTM: "#0891b2", "Shared bike": "#16a34a" };
const modes = DEFAULT_TRANSPORT_TYPES;
const statuses: Status[] = ["In service", "At stop", "Station available"];
const formats = new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Kuala_Lumpur" });
const linkBikeSearchStations = linkBikeSnapshot(EPOCH).stations.map(adaptLinkBikeStation);
const localBusStops = new Map<string, SearchBusStop>();
for (const record of busStops) {
  const sourceId = record.stopRefs?.[0]?.split(":").at(-1);
  if (!sourceId || !record.position || !record.routeId) continue;
  const id = `bus-stop:rapid-bus-mrtfeeder:${sourceId}`;
  const prior = localBusStops.get(id);
  const route = { id: record.routeId, name: record.routeId };
  if (prior) {
    if (!prior.routes.some(item => item.id === route.id)) prior.routes.push(route);
  } else {
    localBusStops.set(id, { id, sourceId, name: record.name, position: record.position, operator: record.operator,
      feed: "MRT Feeder Bus", aliases: [], routes: [route], simulatedPosition: true });
  }
}

export default function Dashboard({ initialTime }: { initialTime: number }) {
  const [now, setNow] = useState(initialTime);
  const [query, setQuery] = useState("");
  const [busRouteId, setBusRouteId] = useState("");
  const [activeModes, setModes] = useState<Mode[]>(DEFAULT_TRANSPORT_TYPES);
  const [activeStatus, setStatuses] = useState<Status[]>([]);
  const [showSimulated, setShowSimulated] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [navigation, setNavigation] = useState<JourneyNavigation | null>(null);
  const [preview, setPreview] = useState<{ vehicleId: string; start: number } | null>(null);
  const [alertId, setAlertId] = useState<string | null>(null);
  const [alertFilter, setAlertFilter] = useState("All");
  const [resetSignal, setResetSignal] = useState(0);
  const [micromobility, setMicromobility] = useState<MicromobilityResponse | null>(null);
  const [staticBus, setStaticBus] = useState<{ stops: SearchBusStop[]; unavailable: string[] } | null>(null);

  const refresh = () => setNow(simulationTime());
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/bus-stops", { signal: controller.signal }).then(async response => {
      const data = busStopSearchResponseSchema.parse(await response.json());
      if (!controller.signal.aborted) setStaticBus(data);
    }).catch(() => {
      if (!controller.signal.aborted) setStaticBus({ stops: [], unavailable: ["bus"] });
    });
    return () => controller.abort();
  }, []);

  const searchIndex = useMemo(() => {
    const stops = new Map(localBusStops);
    for (const stop of staticBus?.stops ?? []) stops.set(stop.id, stop);
    return buildStationSearchIndex(railNetwork, [...stops.values()], micromobility?.stations ?? linkBikeSearchStations);
  }, [staticBus, micromobility]);
  const stationResults = useMemo(() => findStations(searchIndex, query), [searchIndex, query]);
  const snapshot = useMemo(() => simulationSnapshot(now), [now]);
  const exactStation = useMemo(() => resolveExactStation(query, railNetwork), [query]);
  const filterQuery = exactStation?.name ?? normaliseSearchText(query);
  const transport = useMemo(() => transportTypeFilter(railNetwork, activeModes, busRouteId), [activeModes, busRouteId]);
  const results = useMemo(() => showSimulated ? filterRecords(snapshot.records, filterQuery, [], activeStatus, [SIMULATED])
    .filter(transport.showsRecord) : [], [snapshot, filterQuery, activeStatus, showSimulated, transport]);
  const record = snapshot.records.find(item => item.id === selectedId && transport.showsRecord(item));
  const train = record && snapshot.trains.find(item => item.id === record.id);
  const journey = useMemo(() => record?.mode === "Bus" ? busJourney(record.id, now, preview?.vehicleId, preview?.start) : null, [record, now, preview]);
  const alert = snapshot.alerts.find(item => item.id === alertId);
  const byMode = modes.map(name => ({ name, records: activeModes.includes(name)
    ? results.filter(item => item.modes?.includes(name) ?? item.mode === name).length : 0 }));
  const routeCount = new Set(results.flatMap(item => item.railLines
    ? item.railLines.filter(id => transport.railIds.has(id))
    : item.routeId ? [item.routeId] : [])).size;
  const severity = [
    { name: "High", colour: "#dc2626" }, { name: "Medium", colour: "#d97706" }, { name: "Low", colour: "#16a34a" },
  ].map(item => ({ ...item, value: snapshot.alerts.filter(notice => notice.severity === item.name).length }));
  const filteredAlerts = snapshot.alerts.filter(item => alertFilter === "All" || item.category === alertFilter || item.modes.includes(alertFilter as Mode));

  const selectRecord = useCallback((item: TransitRecord | null) => {
    setSelectedId(item?.id ?? null);
    setNavigation(null);
    setPreview(null);
  }, []);
  const stationSearch = useStationSearch(railNetwork, query,
    exactStation && results.some(item => item.id === exactStation.id) ? exactStation : undefined, selectRecord);

  function select(item: TransitRecord | null) {
    stationSearch.cancel();
    selectRecord(item);
  }

  function canSelectStation(entity: SearchEntity) {
    if (entity.type === "RAIL_STATION") return transport.showsRecord(entity.record);
    if (entity.type === "BUS_STOP") return showSimulated && (busRouteId
      ? entity.stop.routes.some(route => transport.showsBusRoute(route.id)) : transport.bus);
    return transport.sharedBike;
  }

  function toggleMode(mode: Mode) {
    const next = toggle(activeModes, mode);
    const nextFilter = transportTypeFilter(railNetwork, next, busRouteId);
    const request = stationSearch.request;
    if (record && !nextFilter.showsRecord(record) || request?.type === "BUS_STOP" && !nextFilter.bus ||
      request?.type === "MICROMOBILITY_STATION" && !nextFilter.sharedBike) select(null);
    setModes(next);
  }

  function reset() {
    setQuery("");
    setBusRouteId("");
    setModes(DEFAULT_TRANSPORT_TYPES);
    setStatuses([]);
    setShowSimulated(true);
    setAlertId(null);
    setAlertFilter("All");
    select(null);
    setResetSignal(signal => signal + 1);
  }

  return <BusCameraProvider selectedVehicleId={selectedId?.startsWith("bus:") ? selectedId : null} selectedRecordId={selectedId}><main>
    <a className="skip" href="#content">Skip to dashboard content</a>
    <header>
      <div className="brand"><span className="brand-mark">TS</span><div><strong>TransitScope</strong><small>Malaysia</small></div></div>
      <label className="region">Region<select aria-label="Region"><option>Malaysia</option></select></label>
      <div className="fresh"><b>{SIMULATED}</b><span>Updated {formats.format(now)}</span></div>
      <button className="icon-button" aria-label="Refresh transport information" onClick={refresh}>↻</button>
    </header>
    <div className="shell">
      <nav aria-label="Primary navigation">
        <a className="nav-active" href="#overview">Overview</a><a href="#map">Map</a><a href="#records">Routes &amp; Stops</a>
        <a href="#alerts">Service Alerts</a><a href="#about">About this information</a>
        <p className="nav-note">Current data mode<br/><strong>{SIMULATED}</strong></p>
      </nav>
      <section id="content" className="content">
        <div className="page-heading">
          <div><p className="eyebrow">PUBLIC TRANSPORT</p><h1 id="overview">Malaysia transport overview</h1></div>
          <button className="secondary" onClick={reset}>Reset dashboard</button>
        </div>
        <p className="status simulation-notice"><strong>SIMULATION MODE</strong> — All transportation information is generated for demonstration purposes and does not represent actual operational conditions.</p>
        <section className="kpis" aria-label="Transport indicators">
          <Kpi label="Vehicles" value={results.filter(item => item.recordKind === "vehicle").length} hint="For your current filters"/>
          <Kpi label="Routes" value={routeCount} hint="For your current filters"/>
          <Kpi label="Service updates" value={snapshot.alerts.length} hint="Simulated notices"/>
          <Kpi label="Shared-bike stations" value={results.filter(item => item.mode === "Shared bike").length} hint="For your current filters"/>
        </section>
        <section className="filters" aria-label="Dashboard filters">
          <div><span>Transport type</span>{modes.map(mode => <Filter key={mode} label={mode} active={activeModes.includes(mode)} onClick={() => toggleMode(mode)}/>)}</div>
          <div><label>Bus route <select value={busRouteId} onChange={event => { setBusRouteId(event.target.value); select(null); }}>
            <option value="">All routes</option>{busRoutes.map(route => <option key={route.id} value={route.id}>{route.id}</option>)}
          </select></label></div>
          <div><span>Service status</span>{statuses.map(status => <Filter key={status} label={status} active={activeStatus.includes(status)} onClick={() => setStatuses(items => toggle(items, status))}/>)}</div>
          <div><span>Information</span><Filter label={SIMULATED} active={showSimulated} onClick={() => setShowSimulated(value => !value)}/></div>
        </section>
        <section className="two-col" id="map">
          <div className="panel">
            <div className="panel-title"><div><h2>Transport map</h2><p>{resultCountLabel(results.length)}. Select a vehicle or stop to learn more.</p></div><button className="secondary" onClick={() => setResetSignal(signal => signal + 1)}>Fit to region</button></div>
            <TransitMap records={results} busRouteId={busRouteId} showBusRoutes={showSimulated && transport.bus} selected={record} onSelect={select} resetSignal={resetSignal}
              railLines={transport.railLines} showSharedBike={transport.sharedBike}
              stationSearch={stationSearch.request} searchActive={query.trim().length > 0} onSearchPopupClose={stationSearch.dismiss}
              onMicromobilityData={setMicromobility}
              search={<StationSearchInput query={query} results={stationResults} request={stationSearch.request}
                loading={!staticBus} limited={Boolean(staticBus?.unavailable.length)}
                onChange={value => { stationSearch.cancel(); setQuery(value); }} onSelect={stationSearch.selectEntity} canSelect={canSelectStation}/>}
              journey={journey} navigation={navigation} onLocate={() => {
                if (!journey) return;
                setPreview(null);
                setNavigation({ journeyId: journey.currentJourneyId, action: (navigation?.action ?? 0) + 1 });
              }} trains={snapshot.trains} bikes={snapshot.linkBike.stations} now={now} onRefresh={refresh}/>
          </div>
          <aside className="detail panel" aria-label="Selected transport detail">
            {journey && record ? <SimulatedBusPanel key={record.id} journey={journey} navigation={navigation} onNavigate={setNavigation}
              onPreview={setPreview} onClose={() => select(null)} onRefresh={refresh}><Details record={record}/></SimulatedBusPanel>
              : train ? <EstimatedTrainPanel train={train} now={now} onClose={() => select(null)}/>
              : record?.recordKind === "stop" ? <>
                <UpcomingDepartures key={record.id} record={record} now={now} onRefresh={refresh}
                  operations={<StationOperations key={record.id} record={record} simulationAlerts={snapshot.alerts}/>}/>
                <details className="station-technical"><summary>Technical information</summary><Details record={record}/></details>
              </> : record ? <><h2>{record.name}</h2><Details record={record}/></>
              : <><h2>Select a vehicle or stop</h2><p>Choose a map marker or an item in the list to see journey information.</p></>}
          </aside>
        </section>
        <section className="chart-grid" aria-label="Data visualisations">
          <div className="panel"><h2>Transport by mode</h2><p>For your current filters</p><div className="chart"><ResponsiveContainer>
            <BarChart data={byMode}><XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0}/><YAxis allowDecimals={false}/><Tooltip/>
              <Bar dataKey="records" radius={[4,4,0,0]}>{byMode.map(item => <Cell key={item.name} fill={colours[item.name]}/>)}</Bar></BarChart>
          </ResponsiveContainer></div></div>
          <div className="panel"><h2>Service updates by impact</h2><p>Simulated notices</p><div className="chart"><ResponsiveContainer>
            <PieChart><Pie data={severity} dataKey="value" nameKey="name" outerRadius={88} label>{severity.map(item => <Cell key={item.name} fill={item.colour}/>)}</Pie><Tooltip/></PieChart>
          </ResponsiveContainer></div></div>
        </section>
        <section className="panel" id="records">
          <div className="panel-title"><div><h2>Vehicles, routes and stops</h2><p>Browse vehicles and stations, including optional map overlays.</p></div><span className="results-count">{resultCountLabel(results.length)}</span></div>
          <div className="table-scroll"><table><thead><tr><th>Name / identifier</th><th>Mode</th><th>Route or station</th><th>Service status</th><th>Information</th><th>Last updated</th><th>Action</th></tr></thead>
            <tbody>{results.map(item => <tr key={item.id}><td><strong>{passengerName(item.name)}</strong></td>
              <td><span className="mode-dot" style={{ background: colours[item.mode] }}/> {item.mode}</td>
              <td>{item.lineNames?.join(" · ") || item.route || item.station}</td><td>{item.status}</td><td><b className="mode-badge">{SIMULATED}</b></td>
              <td>{item.reportedAt ? formats.format(now) : "—"}</td><td><button className="link-button" onClick={() => stationSearch.select(item)}>View details</button></td>
            </tr>)}</tbody></table></div>
          {results.length === 0 && <div className="empty"><strong>No matching vehicles or stops</strong><p>Change the filters or restore defaults.</p><button className="secondary" onClick={reset}>Restore defaults</button></div>}
        </section>
        <section className="panel alerts" id="alerts">
          <h2>Service alerts</h2>
          <label>Filter alerts <select aria-label="Filter alerts" value={alertFilter} onChange={event => setAlertFilter(event.target.value)}>
            {["All", ...modes.filter(mode => mode !== "Shared bike"), "Disruption", "Delay", "Normal service", "Restoration"].map(option => <option key={option} value={option}>{option === "All" ? "All updates" : option}</option>)}
          </select></label>
          {filteredAlerts.map(item => <button className="alert-card" key={item.id} onClick={() => {
            setAlertId(item.id);
            const target = snapshot.records.find(candidate => candidate.recordKind === "stop" && item.stations.includes(candidate.name) &&
              item.routeIds.some(id => candidate.routeId === id || candidate.railLines?.includes(id)));
            if (target) select(target);
          }}><span className={`severity ${item.severity.toLowerCase()}`}>{item.severity}</span><strong>{item.title}</strong>
            <small>{SIMULATED} · {item.category} · {item.routes.join(", ")} · {formats.format(new Date(item.startedAt))}</small></button>)}
          {!filteredAlerts.length && <p className="empty">No matching service updates.</p>}
          {alert && <div className="alert-detail" role="dialog" aria-label="Alert detail">
            <button aria-label="Close alert detail" className="close" onClick={() => setAlertId(null)}>×</button><h3>{alert.title}</h3>
            <p>{alert.description}</p><dl><dt>Information</dt><dd>{SIMULATED}</dd><dt>Affected route</dt><dd>{alert.routes.join(", ")}</dd>
              {alert.stations.length > 0 && <><dt>Affected station</dt><dd>{alert.stations.join(", ")}</dd></>}
              <dt>Time window</dt><dd>{formats.format(new Date(alert.startedAt))}{alert.endsAt && alert.endsAt !== alert.startedAt && ` – ${formats.format(new Date(alert.endsAt))}`}</dd></dl>
          </div>}
        </section>
        <section className="about" id="about"><h2>About this information</h2><p>Vehicle movements, timetables, notices and bike availability follow a shared simulation clock. Route and station coordinates are approximate.</p>
          <p>Bus paths and stop order come from published GTFS. Positions, ETAs and headways are simulated ({busRoutes.map(route => route.id + " " + route.period / route.fleetSize / MINUTE + " min").join(" · ")}). Stop markers are projected onto route paths, and boarding bays remain unverified.</p>
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Map © OpenStreetMap contributors</a>
        </section>
      </section>
    </div>
  </main></BusCameraProvider>;
}

function toggle<T>(items: T[], item: T) {
  return items.includes(item) ? items.filter(value => value !== item) : [...items, item];
}

function Filter({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button aria-pressed={active} className={active ? "filter active" : "filter"} onClick={onClick}>{label}</button>;
}

function Kpi({ label, value, hint }: { label: string; value: number; hint: string }) {
  return <article className="kpi"><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

function Details({ record }: { record: TransitRecord }) {
  return <dl className="details">
    <dt>Data status</dt><dd>{SIMULATED}</dd><dt>Identifier</dt><dd>{record.id}</dd><dt>Operator</dt><dd>{record.operator}</dd>
    <dt>Mode</dt><dd>{record.mode}</dd><dt>Route or station</dt><dd>{record.lineNames?.join(" · ") || record.route || record.station}</dd>
    <dt>Coordinates</dt><dd>{record.position?.map(value => value.toFixed(5)).join(", ")}</dd>
    {record.recordKind === "vehicle" && <><dt>Trip ID</dt><dd>{record.tripId}</dd><dt>Bearing</dt><dd>{record.bearing}°</dd><dt>Speed</dt><dd>{record.speed} km/h</dd></>}
    {record.mode === "Shared bike" && <><dt>Available bicycles</dt><dd>{record.bikesAvailable}</dd><dt>Available docks</dt><dd>{record.docksAvailable}</dd></>}
    <dt>Service status</dt><dd>{record.status}</dd>
  </dl>;
}
