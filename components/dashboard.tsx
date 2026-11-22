"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { filterRecords, type Mode, type Record as TransitRecord, type Status } from "@/lib/transit-data";
import { simulationSnapshot } from "@/lib/simulation";
import { EPOCH, MINUTE, SIMULATED, simulationTime } from "@/lib/simulation/clock";
import { busRoutes, busStopReviews, busStops, railNetwork } from "@/lib/simulation/network";
import { linkBikeSnapshot, type SimulationAlert } from "@/lib/simulation/scenarios";
import { busJourney } from "@/lib/simulation/vehicles";
import { resultCountLabel } from "./passenger-copy";
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
import { CategoryIcon, RouteCategories, VehicleCategories } from "./overview-categories";
import { busStopRegion, defaultRegion, klangValleyRoutes, micromobilityRegion, penangBusFeed, penangBusStops,
  regions, simulationRecordRegion, staticBusRoutes, vehicleCategory, type OverviewRoute, type Region } from "@/lib/dashboard-region";

const TransitMap = dynamic(() => import("./transit-map"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map controls…</div>,
});

const modes = DEFAULT_TRANSPORT_TYPES;
const dashboardSections = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "service-updates", label: "Service Alerts", icon: "alert" },
  { id: "map", label: "Map", icon: "map" },
  { id: "nearby-transit", label: "Nearby Public Transport", icon: "nearby" },
  { id: "about", label: "About this information", icon: "info" },
] as const;
type DashboardSection = typeof dashboardSections[number]["id"];
const brandWordmark = "/brand/transitscope-horizontal.svg";
const brandIcon = "/brand/transitscope-icon.svg";
const statuses: Status[] = ["In service", "At stop", "Station available"];
const formats = new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Kuala_Lumpur" });
const linkBikeSearchStations = linkBikeSnapshot(EPOCH).stations.map(adaptLinkBikeStation);
const penangBikeIds = new Set(linkBikeSearchStations.map(station => station.id));
const emptyRailNetwork = { ...railNetwork, lines: [], busLines: [], stations: [] };
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
  const [region, setRegion] = useState<Region>(defaultRegion);
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
  const inKlangValley = region === "Klang Valley";
  const regionNetwork = inKlangValley ? railNetwork : emptyRailNetwork;
  const regionalPenangStops = useMemo(() => penangBusStops(staticBus?.stops ?? []), [staticBus]);
  const penangRoutes = useMemo(() => staticBusRoutes(regionalPenangStops), [regionalPenangStops]);
  const exactStation = useMemo(() => resolveExactStation(query, railNetwork), [query]);
  const filterQuery = exactStation?.name ?? normaliseSearchText(query);
  const transport = useMemo(() => transportTypeFilter(regionNetwork, activeModes, busRouteId), [regionNetwork, activeModes, busRouteId]);
  const results = useMemo(() => showSimulated ? filterRecords(snapshot.records, filterQuery, [], activeStatus, [SIMULATED])
    .filter(item => simulationRecordRegion(item, penangBikeIds) === region && transport.showsRecord(item)) : [],
    [snapshot, filterQuery, activeStatus, showSimulated, region, transport]);
  const visibleStaticStops = useMemo(() => !inKlangValley && transport.bus && (!activeStatus.length || activeStatus.includes("Station available"))
    ? regionalPenangStops.filter(stop => (!busRouteId || stop.routes.some(route => route.id === busRouteId)) &&
      (!filterQuery || [stop.name, stop.sourceId, ...stop.aliases, ...stop.routes.flatMap(route => [route.id, route.name])]
        .some(value => normaliseSearchText(value).includes(filterQuery)))) : [],
    [inKlangValley, transport.bus, activeStatus, regionalPenangStops, busRouteId, filterQuery]);
  const regionalAlerts = inKlangValley ? snapshot.alerts : [];
  const visibleAlerts = regionalAlerts.filter(alert => serviceAlertMatchesTransport(alert, activeModes, transport.showsBusRoute));
  const alertScope = includeHiddenAlerts ? regionalAlerts : visibleAlerts;
  const filteredAlerts = useMemo(() => alertFilter === "All" ? alertScope : alertScope.filter(alert =>
    alert.category === alertFilter || alert.modes.some(mode => mode === alertFilter)), [alertScope, alertFilter]);
  const displayedAlertIds = useMemo(() => alertsExpanded ? new Set(filteredAlerts.map(alert => alert.id)) : undefined,
    [alertsExpanded, filteredAlerts]);
  const routeIds = new Set(results.flatMap(item => item.railLines
    ? item.railLines.filter(id => transport.visibleLineIds.has(id))
    : item.routeId ? [item.routeId] : []));
  for (const stop of visibleStaticStops) {
    for (const route of stop.routes) if (transport.showsBusRoute(route.id)) routeIds.add(route.id);
  }
  const routes = (inKlangValley ? klangValleyRoutes : penangRoutes).filter(route => routeIds.has(route.id));
  const vehicleCategories = new Map<OverviewRoute["category"], number>();
  const vehicles = results.filter(item => item.recordKind === "vehicle");
  for (const vehicle of vehicles) {
    const category = vehicleCategory(vehicle);
    vehicleCategories.set(category, (vehicleCategories.get(category) ?? 0) + 1);
  }
  const busRouteOptions = inKlangValley ? busRoutes : penangRoutes;
  const bicycleStations = new Set(results.filter(item => item.mode === "Shared bike").map(item => item.id));
  if (showSimulated && transport.sharedBike && (!activeStatus.length || activeStatus.includes("Station available"))) {
    for (const station of micromobility?.stations ?? []) {
      if (station.operator === "HELLORIDE" && micromobilityRegion(station) === region &&
          (!filterQuery || normaliseSearchText(station.name).includes(filterQuery))) bicycleStations.add(station.id);
    }
  }
  const penangBusStatus = !staticBus ? "Rapid Penang bus coverage is loading."
    : staticBus.unavailable.some(feed => feed === penangBusFeed || feed === "bus") ? "Rapid Penang bus coverage is unavailable."
    : "Rapid Penang routes and stops are from static GTFS.";
  const stationCount = new Set(results.flatMap(item => item.recordKind === "stop" && item.mode !== "Shared bike"
    ? [item.railLines?.length ? item.id : item.stopRefs?.[0]?.split(":").at(-1) ?? item.id] : [])).size + visibleStaticStops.length;

  const selectRecord = useCallback((item: TransitRecord | null) => {
    setSelectedId(item?.id ?? null);
    setNavigation(null);
    setPreview(null);
  }, []);
  const selectSearchRecord = useCallback((record: TransitRecord | null) => {
    const nextRegion = record && simulationRecordRegion(record, penangBikeIds);
    if (nextRegion && nextRegion !== region) {
      setRegion(nextRegion);
      setBusRouteId("");
    }
    selectRecord(record);
  }, [region, selectRecord]);
  const exactStationVisible = exactStation && (exactStation.stationProvenance?.length ||
    results.some(item => item.id === exactStation.id) ||
    (!inKlangValley && showSimulated && (!activeStatus.length || activeStatus.includes("Station available")) && canSelectRail(exactStation)));
  const stationSearch = useStationSearch(railNetwork, query,
    exactStationVisible ? exactStation : undefined, selectSearchRecord);
  const alertRequest = stationSearch.request?.alert ? stationSearch.request : null;
  const nearbyRequest = stationSearch.request?.nearby ? stationSearch.request : null;
  const nearbyStation = nearbyRequest?.type === "RAIL_STATION"
    ? railNetwork.stations.find(station => station.id === nearbyRequest.stationId) : undefined;
  const mapRailLines = useMemo(() => nearbyStation ? railNetwork.lines.filter(line =>
    transport.visibleLineIds.has(line.id) || nearbyStation.railLines?.includes(line.id)) : transport.railLines, [transport, nearbyStation]);
  const record = nearbyStation ?? snapshot.records.find(item => item.id === selectedId && simulationRecordRegion(item, penangBikeIds) === region && (item.id === alertRequest?.stationId ||
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

  function canSelectRail(record: TransitRecord) {
    if (record.stationProvenance?.length) return true;
    const scope = simulationRecordRegion(record, penangBikeIds);
    return scope === region ? transport.showsRecord(record)
      : scope === "Klang Valley" && transportTypeFilter(railNetwork, activeModes, "").showsRecord(record);
  }

  function canSelectStation(entity: SearchEntity) {
    if (entity.type === "RAIL_STATION") return canSelectRail(entity.record);
    if (entity.type === "BUS_STOP") return transport.bus && (showSimulated || busStopRegion(entity.stop) === "Penang") &&
      (!busRouteId || busStopRegion(entity.stop) !== region || entity.stop.routes.some(route => transport.showsBusRoute(route.id)));
    return transport.sharedBike;
  }

  function selectStation(entity: SearchEntity, nearby = false) {
    const nextRegion = entity.type === "RAIL_STATION" ? simulationRecordRegion(entity.record, penangBikeIds)
      : entity.type === "BUS_STOP" ? busStopRegion(entity.stop) : micromobilityRegion(entity.station);
    if (nextRegion && nextRegion !== region) {
      setRegion(nextRegion);
      setBusRouteId("");
      if (nearby) setQuery("");
    }
    setAlertNavigation(null);
    stationSearch.selectEntity(entity, undefined, nearby);
  }

  function toggleMode(mode: Mode) {
    const next = toggle(activeModes, mode);
    const nextFilter = transportTypeFilter(regionNetwork, next, busRouteId);
    const request = stationSearch.request;
    if (!alertRequest && (record && !nextFilter.showsRecord(record) || request?.type === "BUS_STOP" && !nextFilter.bus ||
      request?.type === "MICROMOBILITY_STATION" && !nextFilter.sharedBike)) select(null);
    setModes(next);
  }

  function reset() {
    setRegion(defaultRegion);
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
      <label className="region">Region<select value={region} onChange={event => {
        const next = regions.find(option => option === event.target.value);
        if (!next) return;
        select(null);
        setQuery("");
        setBusRouteId("");
        setRegion(next);
      }}>{regions.map(option => <option key={option}>{option}</option>)}</select></label>
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
          <div><p className="eyebrow">PUBLIC TRANSPORT</p><h1 id="overview" tabIndex={-1}>Transport overview</h1></div>
          <button className="secondary" onClick={reset}>Reset dashboard</button>
        </div>
        <p className="status simulation-notice"><strong>SIMULATION MODE</strong> — Vehicle movements, notices and micromobility availability are simulated for demonstration purposes.</p>
        <section className="kpis" aria-label="Transport indicators">
          <article className="kpi" aria-labelledby="vehicles-label">
            <h2 id="vehicles-label">Vehicles</h2><strong>{vehicles.length}</strong>
            <VehicleCategories categories={vehicleCategories}/>
            {vehicles.length > 0 && <select className="overview-vehicle-picker" aria-label="Vehicle details"
              value={record?.recordKind === "vehicle" ? record.id : ""} onChange={event => {
                const vehicle = vehicles.find(item => item.id === event.target.value);
                if (vehicle) {
                  setAlertNavigation(null);
                  stationSearch.select(vehicle);
                } else select(null);
              }}>
              <option value="">Select a vehicle</option>
              {vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>)}
            </select>}
          </article>
          <article className="kpi overview-routes" aria-labelledby="routes-label">
            <h2 id="routes-label">Routes</h2><strong>{routes.length}</strong>
            {!inKlangValley && <small role="status">{penangBusStatus}</small>}
            <RouteCategories routes={routes}/>
          </article>
          <ServiceUpdates state={{ status: "ready", alerts: filteredAlerts, hasAvailableAlerts: alertScope.length > 0 }}
            expanded={alertsExpanded} filter={alertFilter}
            hiddenAlerts={visibleAlerts.length < regionalAlerts.length || includeHiddenAlerts ? { included: includeHiddenAlerts, onChange: setIncludeHiddenAlerts } : undefined}
            navigationStatus={alertNavigation}
            onToggle={() => setAlertsExpanded(value => !value)} onFilter={setAlertFilter} onSelectStation={selectAlertStation}/>
          <article className="kpi" aria-labelledby="bicycle-stations-label">
            <h2 className="overview-category-heading" id="bicycle-stations-label"><CategoryIcon category="Shared bike"/>Shared-bike stations</h2>
            <strong>{bicycleStations.size}</strong><small>Simulated station locations</small>
          </article>
        </section>
        <section className="filters" aria-label="Dashboard filters">
          <div><span>Transport type</span>{modes.map(mode => <Filter key={mode} label={mode} active={activeModes.includes(mode)} onClick={() => toggleMode(mode)}/>)}</div>
          <div><label>Bus route <select value={busRouteId} onChange={event => { setBusRouteId(event.target.value); select(null); }}>
            <option value="">All routes</option>{busRouteOptions.map(route => <option key={route.id} value={route.id}>
              {!inKlangValley || route.id === brtSunway.id ? route.name : route.id}</option>)}
          </select></label></div>
          <div><span>Service status</span>{statuses.map(status => <Filter key={status} label={status} active={activeStatus.includes(status)} onClick={() => setStatuses(items => toggle(items, status))}/>)}</div>
          <div><span>Information</span><Filter label={SIMULATED} active={showSimulated} onClick={() => setShowSimulated(value => !value)}/></div>
        </section>
        <section className="two-col" id="map" tabIndex={-1}>
          <div className="panel">
            <div className="panel-title"><div><h2>Transport map</h2><p>{resultCountLabel(results.length + visibleStaticStops.length)} · {stationCount} stations and stops</p></div><button className="secondary" onClick={() => {
              if (alertRequest || nearbyRequest) select(null);
              setResetSignal(signal => signal + 1);
            }}>Fit to region</button></div>
            <TransitMap region={region} staticBusStops={visibleStaticStops}
              onSelectStaticStop={stop => selectStation({ ...stop, type: "BUS_STOP", sourceIds: [stop.sourceId], stop })}
              records={results} busRouteId={busRouteId}
              showBusRoutes={inKlangValley && showSimulated && transport.bus} selected={record} onSelect={select} resetSignal={resetSignal}
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
                onSelect={entity => selectStation(entity)} canSelect={canSelectStation}/>}
              journey={journey} navigation={navigation} onLocate={() => {
                if (!journey) return;
                setPreview(null);
                setNavigation({ journeyId: journey.currentJourneyId, action: (navigation?.action ?? 0) + 1 });
              }} trains={snapshot.trains} bikes={inKlangValley ? [] : snapshot.linkBike.stations} now={now} onRefresh={refresh}/>
          </div>
          <NearbyPublicTransport {...nearbyLocation} candidates={nearbyCandidates} routeColours={routeColours}
            busCoverage={!staticBus ? "loading" : staticBus.unavailable.length ? "partial" : "ready"}
            selectedId={nearbyRequest?.stationId} onSelect={candidate => selectStation(candidate, true)} onClear={() => {
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
              : <><h2>Select a vehicle or stop</h2><p>Choose a map marker or search for a station to see transport details.</p></>}
          </aside>
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
