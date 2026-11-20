"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { filterRecords, type Mode, type Record as TransitRecord, type Status } from "@/lib/transit-data";
import { simulationSnapshot } from "@/lib/simulation";
import { EPOCH, MINUTE, SIMULATED, simulationTime } from "@/lib/simulation/clock";
import { busRoutes, busStopReviews, busStops, railNetwork } from "@/lib/simulation/network";
import { linkBikeSnapshot, type SimulationAlert } from "@/lib/simulation/scenarios";
import { busJourney } from "@/lib/simulation/vehicles";
import { passengerName, resultCountLabel } from "./passenger-copy";
import SimulatedBusPanel, { type JourneyNavigation } from "./simulated-bus-panel";
import UpcomingDepartures from "./upcoming-departures";
import StationOperations from "./station-operations";
import EstimatedTrainPanel from "./estimated-train-panel";
import { BusCameraProvider } from "./bus-camera-context";
import { buildStationSearchIndex, findStations, normaliseSearchText, resolveAlertStations, resolveExactStation, type SearchEntity } from "@/lib/station-search";
import { adaptLinkBikeStation, type MicromobilityResponse } from "@/lib/micromobility";
import { busStopSearchResponseSchema, type SearchBusStop } from "@/lib/bus-stop-search";
import useStationSearch from "./use-station-search";
import StationSearchInput from "./station-search-input";
import { DEFAULT_TRANSPORT_TYPES, transportTypeFilter } from "@/lib/transport-type-filter";
import { brtSunway } from "@/lib/expanded-services";
import { serviceAlertMatchesTransport } from "@/lib/service-impact";
import ServiceUpdates from "./service-updates";
import NearbyPublicTransport, { useNearbyLocation } from "./nearby-public-transport";
import { nearbyTransitCandidates } from "@/lib/nearby-transit";
import DashboardIcon from "./dashboard-icon";

const TransitMap = dynamic(() => import("./transit-map"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map controls…</div>,
});

const colours: Record<Mode, string> = { Bus: "#2563eb", MRT: "#7c3aed", LRT: "#ea580c", Monorail: "#db2777", KTM: "#0891b2", ERL: "#6941a5", "Shared bike": "#16a34a" };
const modes = DEFAULT_TRANSPORT_TYPES;
const dashboardSections = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "service-updates", label: "Service Alerts", icon: "alert" },
  { id: "nearby-transit", label: "Nearby Public Transport", icon: "nearby" },
  { id: "map", label: "Map", icon: "map" },
  { id: "about", label: "About this information", icon: "info" },
] as const;
type DashboardSection = typeof dashboardSections[number]["id"];
const brandWordmark = "/brand/transitscope-horizontal.svg";
const brandIcon = "/brand/transitscope-icon.svg";
const statuses: Status[] = ["In service", "At stop", "Station available"];
const formats = new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Kuala_Lumpur" });
const linkBikeSearchStations = linkBikeSnapshot(EPOCH).stations.map(adaptLinkBikeStation);
const localBusStops = new Map<string, SearchBusStop>();
const publishedFeederStops: SearchBusStop[] = [];
const routeColours = new Map([...busRoutes, ...railNetwork.lines].map(route => [route.id, route.colour]));
for (const record of busStops) {
  const sourceId = record.stopRefs?.[0]?.split(":").at(-1);
  if (!sourceId || !record.position || !record.routeId) continue;
  const id = `bus-stop:rapid-bus-mrtfeeder:${sourceId}`;
  const prior = localBusStops.get(id);
  const route = { id: record.routeId, name: record.routeId };
  const review = busStopReviews.get(record.id);
  if (review) publishedFeederStops.push({ id, sourceId, name: record.name, position: review.publishedPosition,
    operator: record.operator, feed: "MRT Feeder Bus", aliases: [], routes: [route] });
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
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const [alertFilter, setAlertFilter] = useState("All");
  const [includeHiddenAlerts, setIncludeHiddenAlerts] = useState(false);
  const [alertNavigation, setAlertNavigation] = useState<{ id: string; message: string; pending?: boolean } | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [micromobility, setMicromobility] = useState<MicromobilityResponse | null>(null);
  const [staticBus, setStaticBus] = useState<{ stops: SearchBusStop[]; unavailable: string[] } | null>(null);
  const [activeSection, setActiveSection] = useState<DashboardSection>("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerToggle = useRef<HTMLButtonElement>(null);
  const primaryNavigation = useRef<HTMLElement>(null);
  const nearbyLocation = useNearbyLocation();

  useEffect(() => {
    function updateSectionFromHash() {
      const section = dashboardSections.find(item => `#${item.id}` === window.location.hash)?.id ?? "overview";
      setActiveSection(section);
      if (section === "service-updates") setAlertsExpanded(true);
    }
    updateSectionFromHash();
    window.addEventListener("hashchange", updateSectionFromHash);
    return () => window.removeEventListener("hashchange", updateSectionFromHash);
  }, []);

  useEffect(() => {
    if (drawerOpen) primaryNavigation.current?.querySelector("a")?.focus();
  }, [drawerOpen]);

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
  const nearbyCandidates = useMemo(() => nearbyTransitCandidates(railNetwork, [
    ...(!staticBus || staticBus.unavailable.some(id => id === "bus" || id === "rapid-bus-mrtfeeder") ? publishedFeederStops : []),
    ...(staticBus?.stops ?? []),
  ]), [staticBus]);
  const snapshot = useMemo(() => simulationSnapshot(now), [now]);
  const exactStation = useMemo(() => resolveExactStation(query, railNetwork), [query]);
  const filterQuery = exactStation?.name ?? normaliseSearchText(query);
  const transport = useMemo(() => transportTypeFilter(railNetwork, activeModes, busRouteId), [activeModes, busRouteId]);
  const results = useMemo(() => showSimulated ? filterRecords(snapshot.records, filterQuery, [], activeStatus, [SIMULATED])
    .filter(transport.showsRecord) : [], [snapshot, filterQuery, activeStatus, showSimulated, transport]);
  const visibleAlerts = useMemo(() => snapshot.alerts.filter(alert =>
    serviceAlertMatchesTransport(alert, activeModes, transport.showsBusRoute)), [snapshot.alerts, activeModes, transport]);
  const alertScope = includeHiddenAlerts ? snapshot.alerts : visibleAlerts;
  const filteredAlerts = useMemo(() => alertFilter === "All" ? alertScope : alertScope.filter(alert =>
    alert.category === alertFilter || alert.modes.some(mode => mode === alertFilter)), [alertScope, alertFilter]);
  const displayedAlertIds = useMemo(() => alertsExpanded ? new Set(filteredAlerts.map(alert => alert.id)) : undefined,
    [alertsExpanded, filteredAlerts]);
  const byMode = modes.map(name => ({ name, records: activeModes.includes(name)
    ? results.filter(item => item.modes?.includes(name) ?? item.mode === name).length : 0 }));
  const routeCount = new Set(results.flatMap(item => item.railLines
    ? item.railLines.filter(id => transport.visibleLineIds.has(id))
    : item.routeId ? [item.routeId] : [])).size;
  const stationCount = new Set(results.flatMap(item => item.recordKind === "stop" && item.mode !== "Shared bike"
    ? [item.railLines?.length ? item.id : item.stopRefs?.[0]?.split(":").at(-1) ?? item.id] : [])).size;

  const selectRecord = useCallback((item: TransitRecord | null) => {
    setSelectedId(item?.id ?? null);
    setNavigation(null);
    setPreview(null);
  }, []);
  const stationSearch = useStationSearch(railNetwork, query,
    exactStation && (exactStation.stationProvenance?.length || results.some(item => item.id === exactStation.id)) ? exactStation : undefined, selectRecord);
  const alertRequest = stationSearch.request?.alert ? stationSearch.request : null;
  const nearbyRequest = stationSearch.request?.nearby ? stationSearch.request : null;
  const nearbyStation = nearbyRequest?.type === "RAIL_STATION"
    ? railNetwork.stations.find(station => station.id === nearbyRequest.stationId) : undefined;
  const mapRailLines = useMemo(() => nearbyStation ? railNetwork.lines.filter(line =>
    transport.visibleLineIds.has(line.id) || nearbyStation.railLines?.includes(line.id)) : transport.railLines, [transport, nearbyStation]);
  const record = nearbyStation ?? snapshot.records.find(item => item.id === selectedId && (item.id === alertRequest?.stationId ||
    Boolean(item.stationProvenance?.length && item.id === stationSearch.request?.stationId) || transport.showsRecord(item)));
  const train = record && snapshot.trains.find(item => item.id === record.id);
  const journey = useMemo(() => record?.mode === "Bus" ? busJourney(record.id, now, preview?.vehicleId, preview?.start) : null, [record, now, preview]);
  const cancelStationSearch = stationSearch.cancel;
  useEffect(() => {
    if (!alertRequest || !alertNavigation?.pending) return;
    // A watchdog covers a missing map or popup. The camera itself waits for actual layout readiness.
    const timeout = window.setTimeout(() => {
      alertRequest.alert?.onResult(false);
      cancelStationSearch();
      selectRecord(null);
    }, 8000);
    return () => window.clearTimeout(timeout);
  }, [alertRequest, alertNavigation, cancelStationSearch, selectRecord]);

  function select(item: TransitRecord | null) {
    stationSearch.cancel();
    selectRecord(item);
    setAlertNavigation(null);
  }

  function selectAlertStation(alert: SimulationAlert) {
    const targets = resolveAlertStations(searchIndex, alert.stations, alert.routeIds);
    if (!targets.length) {
      setAlertNavigation({ id: alert.id, message: "No affected station with a verified map location was found." });
      return;
    }
    setAlertNavigation({ id: alert.id, pending: true, message: "Locating affected station on the map…" });
    stationSearch.selectEntity(targets[0], { targets, onResult: success => {
      setAlertNavigation(success ? null : { id: alert.id, message: "The station could not be shown on the map. Try again." });
    } });
  }

  function canSelectStation(entity: SearchEntity) {
    if (entity.type === "RAIL_STATION") return Boolean(entity.record.stationProvenance?.length) || transport.showsRecord(entity.record);
    if (entity.type === "BUS_STOP") return showSimulated && (busRouteId
      ? entity.stop.routes.some(route => transport.showsBusRoute(route.id)) : transport.bus);
    return transport.sharedBike;
  }

  function toggleMode(mode: Mode) {
    const next = toggle(activeModes, mode);
    const nextFilter = transportTypeFilter(railNetwork, next, busRouteId);
    const request = stationSearch.request;
    if (!alertRequest && (record && !nextFilter.showsRecord(record) || request?.type === "BUS_STOP" && !nextFilter.bus ||
      request?.type === "MICROMOBILITY_STATION" && !nextFilter.sharedBike)) select(null);
    setModes(next);
  }

  function reset() {
    setQuery("");
    setBusRouteId("");
    setModes(DEFAULT_TRANSPORT_TYPES);
    setStatuses([]);
    setShowSimulated(true);
    setAlertsExpanded(false);
    setAlertFilter("All");
    setIncludeHiddenAlerts(false);
    select(null);
    setResetSignal(signal => signal + 1);
  }

  function navigateSection(event: MouseEvent<HTMLAnchorElement>, section: DashboardSection) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    setDrawerOpen(false);
    setActiveSection(section);
    if (section === "service-updates") setAlertsExpanded(true);
  }

  function goHome() {
    setActiveSection("overview");
    setDrawerOpen(false);
    if (window.location.hash !== "#overview") window.history.pushState(null, "", "#overview");
    document.getElementById("overview")?.focus({ preventScroll: true });
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "instant" : "smooth" });
  }

  return <BusCameraProvider selectedVehicleId={selectedId?.startsWith("bus:") ? selectedId : null}
    selectedRecordId={nearbyRequest?.stationId ?? selectedId}><main>
    <a className="skip" href="#content">Skip to dashboard content</a>
    <header className="dashboard-header">
      <button type="button" ref={drawerToggle} className="icon-button dashboard-menu-toggle"
        aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={drawerOpen} aria-controls="dashboard-navigation" onClick={() => setDrawerOpen(open => !open)}>
        <DashboardIcon name={drawerOpen ? "close" : "menu"}/>
      </button>
      <Image className="dashboard-brand" src={brandWordmark} width={170} height={48} alt="TransitScope Malaysia" priority/>
      <label className="region">Region<select aria-label="Region"><option>Malaysia</option></select></label>
      <div className="fresh"><b>{SIMULATED}</b><span>Updated {formats.format(now)}</span></div>
      <button className="icon-button" aria-label="Refresh transport information" onClick={refresh}>↻</button>
    </header>
    <div className="shell dashboard-shell" data-sidebar-collapsed={sidebarCollapsed}>
      <nav id="dashboard-navigation" ref={primaryNavigation} className="dashboard-navigation" aria-label="Primary navigation"
        data-drawer-open={drawerOpen} onKeyDown={event => {
          if (event.key === "Escape" && drawerOpen) {
            setDrawerOpen(false);
            drawerToggle.current?.focus();
          }
        }}>
        <div className="sidebar-brand">
          <Image className="sidebar-wordmark" src={brandWordmark} width={170} height={48} alt="TransitScope Malaysia"/>
          <Image className="sidebar-icon" src={brandIcon} width={48} height={48} alt="TransitScope Malaysia"/>
          <button type="button" className="icon-button sidebar-toggle"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed(collapsed => !collapsed)}>
            <DashboardIcon name={sidebarCollapsed ? "expand" : "collapse"}/>
          </button>
        </div>
        {dashboardSections.map(({ id, label, icon }) =>
          <a key={id} href={`#${id}`} aria-current={activeSection === id ? "location" : undefined}
            title={label} onClick={event => navigateSection(event, id)}>
            <DashboardIcon name={icon}/><span className="dashboard-nav-label">{label}</span>
          </a>)}
        <p className="nav-note">Current data mode<br/><strong>{SIMULATED}</strong></p>
      </nav>
      <section id="content" className="content" tabIndex={-1}>
        <div className="page-heading">
          <div><p className="eyebrow">PUBLIC TRANSPORT</p><h1 id="overview" tabIndex={-1}>Malaysia transport overview</h1></div>
          <button className="secondary" onClick={reset}>Reset dashboard</button>
        </div>
        <p className="status simulation-notice"><strong>SIMULATION MODE</strong> — All transportation information is generated for demonstration purposes and does not represent actual operational conditions.</p>
        <section className="kpis" aria-label="Transport indicators">
          <Kpi label="Vehicles" value={results.filter(item => item.recordKind === "vehicle").length} hint="For your current filters"/>
          <Kpi label="Routes" value={routeCount} hint="For your current filters"/>
          <ServiceUpdates state={{ status: "ready", alerts: filteredAlerts, hasAvailableAlerts: alertScope.length > 0 }}
            expanded={alertsExpanded} filter={alertFilter}
            hiddenAlerts={visibleAlerts.length < snapshot.alerts.length || includeHiddenAlerts ? { included: includeHiddenAlerts, onChange: setIncludeHiddenAlerts } : undefined}
            navigationStatus={alertNavigation}
            onToggle={() => setAlertsExpanded(value => !value)} onFilter={setAlertFilter} onSelectStation={selectAlertStation}/>
          <Kpi label="Shared-bike stations" value={results.filter(item => item.mode === "Shared bike").length} hint="For your current filters"/>
        </section>
        <section className="filters" aria-label="Dashboard filters">
          <div><span>Transport type</span>{modes.map(mode => <Filter key={mode} label={mode} active={activeModes.includes(mode)} onClick={() => toggleMode(mode)}/>)}</div>
          <div><label>Bus route <select value={busRouteId} onChange={event => { setBusRouteId(event.target.value); select(null); }}>
            <option value="">All routes</option>{busRoutes.map(route => <option key={route.id} value={route.id}>{route.id === brtSunway.id ? route.name : route.id}</option>)}
          </select></label></div>
          <div><span>Service status</span>{statuses.map(status => <Filter key={status} label={status} active={activeStatus.includes(status)} onClick={() => setStatuses(items => toggle(items, status))}/>)}</div>
          <div><span>Information</span><Filter label={SIMULATED} active={showSimulated} onClick={() => setShowSimulated(value => !value)}/></div>
        </section>
        <section className="two-col" id="map" tabIndex={-1}>
          <div className="panel">
            <div className="panel-title"><div><h2>Transport map</h2><p>{resultCountLabel(results.length)} · {stationCount} stations and stops</p></div><button className="secondary" onClick={() => {
              if (alertRequest || nearbyRequest) select(null);
              setResetSignal(signal => signal + 1);
            }}>Fit to region</button></div>
            <TransitMap records={results} busRouteId={busRouteId} showBusRoutes={showSimulated && transport.bus} selected={record} onSelect={select} resetSignal={resetSignal}
              railLines={mapRailLines} showSharedBike={transport.sharedBike} userLocation={nearbyLocation.location}
              stationSearch={stationSearch.request} searchActive={query.trim().length > 0} onSearchPopupClose={stationSearch.dismiss}
              onMicromobilityData={setMicromobility}
              search={<StationSearchInput query={query} results={stationResults} request={stationSearch.request}
                loading={!staticBus} limited={Boolean(staticBus?.unavailable.length)}
                onChange={value => {
                  if (record?.stationProvenance?.length) select(null);
                  else { stationSearch.cancel(); setAlertNavigation(null); }
                  setQuery(value);
                }}
                onSelect={entity => { setAlertNavigation(null); stationSearch.selectEntity(entity); }} canSelect={canSelectStation}/>}
              journey={journey} navigation={navigation} onLocate={() => {
                if (!journey) return;
                setPreview(null);
                setNavigation({ journeyId: journey.currentJourneyId, action: (navigation?.action ?? 0) + 1 });
              }} trains={snapshot.trains} bikes={snapshot.linkBike.stations} now={now} onRefresh={refresh}/>
          </div>
          <NearbyPublicTransport {...nearbyLocation} candidates={nearbyCandidates} routeColours={routeColours}
            busCoverage={!staticBus ? "loading" : staticBus.unavailable.length ? "partial" : "ready"}
            selectedId={nearbyRequest?.stationId} onSelect={candidate => {
              setAlertNavigation(null);
              stationSearch.selectEntity(candidate, undefined, true);
            }} onClear={() => {
              select(null);
              setResetSignal(signal => signal + 1);
            }}/>
          <aside className="detail panel" aria-label="Selected transport detail">
            {journey && record ? <SimulatedBusPanel key={record.id} journey={journey} navigation={navigation} onNavigate={setNavigation}
              onPreview={setPreview} onClose={() => select(null)} onRefresh={refresh}><Details record={record}/></SimulatedBusPanel>
              : train ? <EstimatedTrainPanel train={train} now={now} onClose={() => select(null)}/>
              : record?.recordKind === "stop" ? <>
                <UpcomingDepartures key={record.id} record={record} now={now} onRefresh={refresh}
                  operations={<StationOperations key={record.id} record={record} simulationAlerts={snapshot.alerts}
                    displayedAlertIds={displayedAlertIds}/>}/>
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
        </section>
        <section className="panel" id="records">
          <div className="panel-title"><div><h2>Vehicles, routes and stops</h2><p>Browse vehicles and stations, including optional map overlays.</p></div><span className="results-count">{resultCountLabel(results.length)}</span></div>
          <div className="table-scroll"><table><thead><tr><th>Name / identifier</th><th>Mode</th><th>Route or station</th><th>Service status</th><th>Information</th><th>Last updated</th><th>Action</th></tr></thead>
            <tbody>{results.map(item => <tr key={item.id}><td><strong>{passengerName(item.name)}</strong></td>
              <td><span className="mode-dot" style={{ background: colours[item.mode] }}/> {item.mode}</td>
              <td>{item.lineNames?.join(" · ") || item.route || item.station}</td><td>{item.status}</td><td><b className="mode-badge">{SIMULATED}</b></td>
              <td>{item.reportedAt ? formats.format(now) : "—"}</td><td><button className="link-button" onClick={() => {
                setAlertNavigation(null);
                stationSearch.select(item);
              }}>View details</button></td>
            </tr>)}</tbody></table></div>
          {results.length === 0 && <div className="empty"><strong>No matching vehicles or stops</strong><p>Change the filters or restore defaults.</p><button className="secondary" onClick={reset}>Restore defaults</button></div>}
        </section>
        <section className="about" id="about" tabIndex={-1}><h2>About this information</h2><p>Vehicle movements, timetables, notices and bike availability follow a shared simulation clock. ERL, Shah Alam and BRT Sunway use published station and route geography. Older simulation alignments and shared station marker locations are approximate.</p>
          <p>Bus paths and stop order come from published GTFS. Positions, ETAs and headways are simulated ({busRoutes.filter(route => route.id !== brtSunway.id).map(route => route.id + " " + route.period / route.fleetSize / MINUTE + " min").join(" · ")}). Feeder bus stop markers are projected onto route paths, and boarding bays remain unverified.</p>
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Map © OpenStreetMap contributors</a>
        </section>
      </section>
    </div>
    <button type="button" className="back-to-home" aria-label="Back to Home" title="Back to Home" onClick={goHome}>
      <DashboardIcon name="home"/>
    </button>
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
    {!!record.stationProvenance?.length && <><dt>Published station data</dt><dd>{record.stationProvenance.map(stop =>
      <div key={stop.routeId}><a href={stop.coordinateUrl} target="_blank" rel="noreferrer">{stop.name} ({stop.code})</a></div>)}</dd></>}
    {record.recordKind === "vehicle" && <><dt>Trip ID</dt><dd>{record.tripId}</dd><dt>Bearing</dt><dd>{record.bearing}°</dd><dt>Speed</dt><dd>{record.speed} km/h</dd></>}
    {record.mode === "Shared bike" && <><dt>Available bicycles</dt><dd>{record.bikesAvailable}</dd><dt>Available docks</dt><dd>{record.docksAvailable}</dd></>}
    <dt>Service status</dt><dd>{record.status}</dd>
  </dl>;
}
