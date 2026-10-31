"use client";
import "leaflet/dist/leaflet.css";
import "@/app/markers.css";
import L from "leaflet";
import { Fragment, useEffect, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import type { MrtLineId, Record } from "@/lib/transit-data";
import type { MrtAlignment } from "@/lib/mrt-lines";

const colours: globalThis.Record<string, string> = { Bus: "#2563eb", MRT: "#7c3aed", LRT: "#ea580c", Monorail: "#db2777", KTM: "#0891b2", "Shared bike": "#16a34a" };
const lines = { MRT1: { name: "MRT Kajang Line (MRT1)", colour: "#006B3F" }, MRT2: { name: "MRT Putrajaya Line (MRT2)", colour: "#F2C500" } };
const vehicleIcon = (mode: Record["mode"], colour: string) => L.divIcon({ className: "transport-icon vehicle-icon", html: `<span style="--marker:${colour}" aria-hidden="true">${mode === "Bus" ? "🚌" : "🚆"}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
const stopIcon = (record: Record) => {
  const colour = record.mrtLines?.length ? lines[record.mrtLines[0]].colour : colours[record.mode];
  return L.divIcon({ className: `transport-icon stop-icon${record.interchange ? " interchange-icon" : ""}`, html: `<span style="--marker:${colour}" aria-hidden="true">●</span>`, iconSize: [20, 20], iconAnchor: [10, 10] });
};
const userIcon = L.divIcon({ className: "transport-icon user-icon", html: '<span aria-hidden="true">●</span>', iconSize: [22, 22], iconAnchor: [11, 11] });
function Reset({ signal }: { signal: number }) {
  const map = useMap();
  useEffect(() => { if (signal) map.setView([3.142, 101.699], 13); }, [signal, map]);
  return null;
}
export default function TransitMap({ records, selected, onSelect, resetSignal }: { records: Record[]; selected: string | null; onSelect: (r: Record) => void; resetSignal: number }) {
  const selectedRecord = records.find(record => record.id === selected);
  const selectedPath = selectedRecord?.recordKind === "vehicle" ? selectedRecord.routePath : null;
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);
  const [alignments, setAlignments] = useState<MrtAlignment[]>([]);
  const [geometryMessage, setGeometryMessage] = useState("Loading MRT railway alignments…");
  const [activeLines, setActiveLines] = useState<MrtLineId[]>([]);
  const [retry, setRetry] = useState(0);
  useEffect(() => { if (navigator.geolocation) navigator.geolocation.getCurrentPosition(position => setUserPosition([position.coords.latitude, position.coords.longitude]), () => undefined, { maximumAge: 60_000, timeout: 10_000 }); }, []);
  useEffect(() => {
    const controller = new AbortController(); const timer = setTimeout(() => { controller.abort(); setGeometryMessage("MRT railway alignment unavailable. Station markers remain available."); }, 20_000);
    setGeometryMessage("Loading MRT railway alignments…");
    fetch("/api/mrt-lines", { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then((payload: { lines: MrtAlignment[]; available: boolean; source: string }) => {
        if (controller.signal.aborted) return;
        setAlignments(payload.lines); setGeometryMessage(payload.available ? "" : payload.source);
      }).catch(() => { if (!controller.signal.aborted) setGeometryMessage("MRT railway alignment unavailable. Station markers remain available."); })
      .finally(() => clearTimeout(timer));
    return () => { controller.abort(); clearTimeout(timer); };
  }, [retry]);
  useEffect(() => { if (selectedRecord?.mrtLines?.length) setActiveLines(selectedRecord.mrtLines); }, [selectedRecord?.id]);
  const toggleLine = (id: MrtLineId) => setActiveLines(current => current.length === 1 && current[0] === id ? [] : [id]);
  return <section className="map-wrap" aria-label="Interactive transport map">
    <MapContainer center={[3.142, 101.699]} zoom={13} scrollWheelZoom className="map">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
      <Reset signal={resetSignal}/>
      {alignments.flatMap(line => line.paths.map((path, index) => {
        const highlighted = activeLines.includes(line.id), dimmed = activeLines.length > 0 && !highlighted;
        return <Fragment key={`${line.id}-${index}`}>
          <Polyline positions={path} interactive={false} pathOptions={{ color: "#fff", weight: highlighted ? 11 : 8, opacity: dimmed ? .35 : .95 }}/>
          <Polyline className={`mrt-alignment ${line.id}`} positions={path} pathOptions={{ color: line.colour, weight: highlighted ? 7 : 5, opacity: dimmed ? .3 : 1 }} eventHandlers={{ click: () => toggleLine(line.id) }}><Popup>{line.name}<br/>STATIC — official GTFS railway alignment</Popup></Polyline>
        </Fragment>;
      }))}
      {selectedPath && selectedPath.length > 1 && <Polyline positions={selectedPath} pathOptions={{ color: colours[selectedRecord!.mode], weight: 5, opacity: .8 }}/>}
      {userPosition && <Marker position={userPosition} icon={userIcon}><Popup><strong>Your current location</strong><br/>Shown only in this browser.</Popup></Marker>}
      {records.filter(record => record.position).map(record => {
        const dimmed = record.mode === "MRT" && activeLines.length > 0 && !record.mrtLines?.some(line => activeLines.includes(line));
        return <Marker key={record.id} title={record.name} position={record.position!} zIndexOffset={record.recordKind === "stop" ? 500 : 0} opacity={dimmed ? .3 : 1} icon={record.recordKind === "vehicle" ? vehicleIcon(record.mode, colours[record.mode]) : stopIcon(record)} eventHandlers={{ click: () => { onSelect(record); if (record.mrtLines?.length) setActiveLines(record.mrtLines); } }}>
          <Popup><strong>{record.name}</strong><br/>{record.route ?? record.station}<br/>{record.dataMode}
            {record.interchange && <><br/>{/kwasa damansara/i.test(record.name) ? "Interchange / terminal for both MRT lines" : "Interchange for both MRT lines"}</>}
            {record.recordKind === "stop" && <><br/>Next scheduled: {record.nextScheduledAt ? new Intl.DateTimeFormat("en-MY", { timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(record.nextScheduledAt)) : "Unavailable"}</>}
          </Popup>
        </Marker>;
      })}
    </MapContainer>
    {geometryMessage && <div className="mrt-geometry-status" role="status">{geometryMessage} <button onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
    <div className="map-legend" aria-label="Map legend">
      {(Object.keys(lines) as MrtLineId[]).map(id => <button key={id} aria-pressed={activeLines.includes(id)} className={activeLines.includes(id) ? "line-legend active" : "line-legend"} onClick={() => toggleLine(id)}><i style={{ background: lines[id].colour }}/>{lines[id].name}</button>)}
      <span>Railway alignments: STATIC</span><span>◉ Interchange</span><span>🚌 Bus / 🚆 Train</span><span><b className="user-dot">●</b> Your location</span><span>○ Station / stop</span>
      {Object.entries(colours).filter(([label]) => label !== "MRT").map(([label, colour]) => <span key={label}><i style={{ background: colour }}/>{label}</span>)}
    </div>
  </section>;
}
