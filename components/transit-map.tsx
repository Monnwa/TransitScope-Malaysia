"use client";
import "leaflet/dist/leaflet.css";
import "@/app/markers.css";
import L from "leaflet";
import { Fragment, useEffect, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { Record } from "@/lib/transit-data";
import type { useRailNetwork } from "./use-rail-network";
import type { BusMapJourney } from "./bus-journey-panel";
import { splitRoutePath, PROGRESS_LIMITS } from "@/lib/route-projection";
const colours: globalThis.Record<string, string> = { Bus: "#2563eb", MRT: "#006B3F", LRT: "#E75480", Monorail: "#2878B5", KTM: "#24558A", "Shared bike": "#16a34a" };
const lastSeenTime=(value:string|null|undefined)=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat("en-MY",{timeZone:"Asia/Kuala_Lumpur",dateStyle:"short",timeStyle:"medium"}).format(new Date(value))+" MYT":"time unavailable";
const vehicleIcon = (record: Record, selected=false) => L.divIcon({ className: `transport-icon vehicle-icon ${selected?"vehicle-selected":""}`, html: `<span style="--marker:${colours[record.mode]}" aria-hidden="true">${record.mode === "Bus" ? "🚌" : "🚆"}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
function Reset({ signal }: { signal: number }) { const map = useMap(); useEffect(() => { if (signal) map.setView([3.142, 101.699], 13); }, [signal, map]); return null; }
function SelectedVehicleFocus({record}:{record:Record|undefined}) {
  const map=useMap();
  useEffect(()=>{
    if(record?.mode!=="Bus"||record.recordKind!=="vehicle"||record.dataMode==="SIMULATED"||!record.position)return;
    map.panTo(record.position,{animate:false});
    if(window.matchMedia("(max-width:720px)").matches){map.getContainer().scrollIntoView({block:"start",behavior:"instant"});window.scrollBy({top:-15,behavior:"instant"});}
    else map.getContainer().scrollIntoView({block:"center",behavior:"instant"});
  },[record?.id,map]);
  return null;
}
export default function TransitMap({ records, selected, onSelect, resetSignal, network, journey }: { records: Record[]; selected: string | null; onSelect: (record: Record) => void; resetSignal: number; network: ReturnType<typeof useRailNetwork>; journey?:BusMapJourney|null }) {
  const [hidden, setHidden] = useState<string[]>([]), [highlighted, setHighlighted] = useState<string[]>([]);
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);
  const selectedRecord = records.find(record => record.id === selected);
  const selectedPath=journey?.vehicleId===selected?journey.path:selectedRecord?.routePath;
  const gps=journey?.vehicleId===selected?journey.tracking:undefined;
  const gpsActive=!!gps?.position&&(gps.source==="GPS_INFERRED"||gps.source==="APPROXIMATE");
  const segments=gpsActive&&gps?.source==="GPS_INFERRED"&&selectedPath&&gps.segment!==null?splitRoutePath(selectedPath,gps.segment,gps.position!):null;
  useEffect(() => { if (selectedRecord?.railLines?.length) { setHighlighted(selectedRecord.railLines); setHidden(current => current.filter(id => !selectedRecord.railLines!.includes(id))); } }, [selectedRecord?.id]);
  useEffect(() => { if (navigator.geolocation) navigator.geolocation.getCurrentPosition(position => setUserPosition([position.coords.latitude, position.coords.longitude]), () => undefined, { maximumAge: 60000, timeout: 10000 }); }, []);
  const lineById = new Map(network.lines.map(line => [line.id, line]));
  const selectLine = (id: string) => setHighlighted(current => current.length === 1 && current[0] === id ? [] : [id]);
  const selectStation = (record: Record) => { onSelect(record); if (record.railLines?.length) { setHighlighted(record.railLines); setHidden(current => current.filter(id => !record.railLines!.includes(id))); } };
  const visibleRecords = records.filter(record => !(record.railLines?.length && record.railLines.every(id => hidden.includes(id))));
  return <section className="rail-map-group">
    <fieldset className="rail-filters"><legend>Railway lines — display colours</legend>
      {network.lines.map(line => <span key={line.id} className="rail-filter-item"><label><input type="checkbox" aria-label={`Show ${line.name}`} checked={!hidden.includes(line.id)} onChange={() => setHidden(current => current.includes(line.id) ? current.filter(id => id !== line.id) : [...current, line.id])}/><i style={{ background: line.colour }}/></label><button className="line-legend" aria-pressed={highlighted.includes(line.id)} onClick={() => selectLine(line.id)}>{line.name}</button>{line.geometryStatus === "unavailable" && <small>Stations only — geometry unavailable</small>}</span>)}
      {!network.lines.length && <span>Railway sources loading or unavailable.</span>}
      {network.messages.map(message => <p role="status" key={message}>{message}</p>)}
      <button className="secondary" onClick={network.retry}>Reload railway data</button>
    </fieldset>
    <div className="map-wrap" aria-label="Interactive transport map"><MapContainer center={[3.142, 101.699]} zoom={13} scrollWheelZoom className="map">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Reset signal={resetSignal}/><SelectedVehicleFocus record={selectedRecord}/>
      {network.lines.filter(line => !hidden.includes(line.id)).flatMap(line => line.paths.map((path, index) => {
        const active = highlighted.includes(line.id), dimmed = highlighted.length > 0 && !active;
        return <Fragment key={`${line.id}:${index}`}><Polyline positions={path} interactive={false} pathOptions={{ color: "#fff", weight: active ? 10 : 7, opacity: dimmed ? .3 : .95 }}/><Polyline className={`rail-alignment ${line.id.replace(/[^a-zA-Z0-9]/g, "-")}`} positions={path} pathOptions={{ color: line.colour, weight: active ? 6 : 4, opacity: dimmed ? .3 : 1 }} eventHandlers={{ click: () => selectLine(line.id) }}><Popup>{line.name}<br/>STATIC — {line.source}</Popup></Polyline></Fragment>;
      }))}
      {(selectedRecord?.recordKind === "vehicle" || journey?.vehicleId===selected&&journey.lastSeen?.available===false) && !!selectedPath?.length && <Polyline className="selected-vehicle-route" positions={selectedPath} pathOptions={{ color: colours[selectedRecord?.mode??"Bus"], weight: 5, opacity:.9 }}><Tooltip>Selected trip route · STATIC GTFS geometry</Tooltip></Polyline>}
      {segments&&<><Polyline className="gps-route-completed" positions={segments.completed} pathOptions={{color:"#65758b",weight:6,opacity:.95}}><Tooltip>Route behind GPS-inferred progress · stop service unconfirmed</Tooltip></Polyline><Polyline className="gps-route-remaining" positions={segments.remaining} pathOptions={{color:"#1666d8",weight:6,opacity:1}}><Tooltip>Remaining matched trip geometry</Tooltip></Polyline></>}
      {!selectedRecord&&journey?.vehicleId===selected&&journey.lastSeen?.available===false&&journey.lastSeen.position&&<CircleMarker className="historical-bus-position" center={journey.lastSeen.position} radius={7} pane="markerPane" pathOptions={{color:"#65758b",fillColor:"#dce5ee",fillOpacity:.7,dashArray:"3 3"}}><Tooltip permanent>Last seen {journey.lastSeen.name} · {lastSeenTime(journey.lastSeen.timestamp)} · historical position</Tooltip></CircleMarker>}
      {visibleRecords.filter(record => record.position).map(record => {
        const dimmed = record.railLines?.length && highlighted.length && !record.railLines.some(id => highlighted.includes(id));
        const markerAge=Date.now()-Date.parse(record.observation?.positionTimestamp??"");
        const markerStale=record.id===selected&&Number.isFinite(markerAge)&&(markerAge>PROGRESS_LIMITS.maxAgeMs||markerAge< -PROGRESS_LIMITS.futureToleranceMs);
        const popup = <Popup><strong>{record.name}</strong><br/>{record.lineNames?.join(" · ") || record.route || record.station}<br/>{markerStale?`STALE · last seen ${lastSeenTime(record.observation?.positionTimestamp)}`:record.dataMode}{record.id===selected&&gps?.source==="STALE"&&<><br/>GPS progress: STALE</>}{record.interchange && <><br/>{/kwasa damansara/i.test(record.name) ? "Interchange / terminal" : "Interchange"}</>}{record.recordKind === "stop" && <><br/>See Upcoming Departures in the station detail panel.</>}</Popup>;
        if (record.recordKind === "vehicle") return <Marker key={record.id} title={record.name} position={record.id===selected&&gpsActive?gps!.position!:record.position!} icon={vehicleIcon(record,record.id===selected)} opacity={markerStale?.5:1} zIndexOffset={record.id===selected?1000:0} eventHandlers={{ click: () => selectStation(record) }}>{popup}<Tooltip>{record.id===selected&&gpsActive?`${gps!.source==="GPS_INFERRED"?"GPS-INFERRED":"APPROXIMATE"} · ${gps!.confidence} confidence`:markerStale?`STALE · last seen ${lastSeenTime(record.observation?.positionTimestamp)}`:record.name}</Tooltip></Marker>;
        const stationColours = (record.railLines ?? []).map(id => lineById.get(id)?.colour).filter(Boolean);
        return <CircleMarker key={record.id} center={record.position!} radius={record.interchange ? 8 : 6} className="rail-station" pane="markerPane" pathOptions={{ color: stationColours[0] ?? colours[record.mode], fillColor: record.interchange ? stationColours[1] ?? "#fff" : "#fff", weight: 3, fillOpacity: dimmed ? .3 : 1, opacity: dimmed ? .3 : 1 }} eventHandlers={{ click: () => selectStation(record) }}><Tooltip>{record.name}</Tooltip>{popup}</CircleMarker>;
      })}
      {userPosition && <Marker position={userPosition} icon={L.divIcon({ className: "transport-icon user-icon", html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] })}><Popup>Your current location</Popup></Marker>}
    </MapContainer><div className="map-legend" aria-label="Map legend"><span>Railway lines / stations: STATIC</span><span>◉ Interchange</span><span>🚌 Bus / 🚆 Train</span><span>● Your location</span><span>○ Station / stop</span>{gpsActive&&<span className="map-progress-key">{gps!.source==="GPS_INFERRED"?"GPS-INFERRED":"APPROXIMATE"} · {gps!.confidence}{segments?" · Grey: route behind · Blue: remaining":""}</span>}</div></div>
  </section>;
}
