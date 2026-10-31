"use client";
import "leaflet/dist/leaflet.css";
import "@/app/markers.css";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { useEffect, useState } from "react";
import type { Record } from "@/lib/transit-data";

const colours: globalThis.Record<string, string> = { Bus: "#2563eb", MRT: "#7c3aed", LRT: "#ea580c", Monorail: "#db2777", KTM: "#0891b2", "Shared bike": "#16a34a" };
const vehicleIcon = (mode: Record["mode"], colour: string) => L.divIcon({ className: "transport-icon vehicle-icon", html: `<span class="${mode === "Bus" ? "bus" : "train"}" style="--marker:${colour}" aria-hidden="true">${mode === "Bus" ? "🚌" : "🚆"}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
const stopIcon = (colour: string) => L.divIcon({ className: "transport-icon stop-icon", html: `<span style="--marker:${colour}" aria-hidden="true">●</span>`, iconSize: [20, 20], iconAnchor: [10, 10] });
const userIcon = L.divIcon({ className: "transport-icon user-icon", html: '<span aria-hidden="true">●</span>', iconSize: [22, 22], iconAnchor: [11, 11] });
function Reset({ signal }: { signal: number }) { const map = useMap(); if (signal) map.setView([3.142, 101.699], 13); return null; }
export default function TransitMap({ records, selected, onSelect, resetSignal }: { records: Record[]; selected: string | null; onSelect: (r: Record) => void; resetSignal: number }) {
  const selectedRecord = records.find(record => record.id === selected);
  const selectedPath = selectedRecord?.recordKind === "vehicle" ? selectedRecord.routePath : null;
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);
  useEffect(() => { if (!navigator.geolocation) return; navigator.geolocation.getCurrentPosition(position => setUserPosition([position.coords.latitude, position.coords.longitude]), () => undefined, { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 }); }, []);
  return <section className="map-wrap" aria-label="Interactive transport map"><MapContainer center={[3.142, 101.699]} zoom={13} scrollWheelZoom className="map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Reset signal={resetSignal}/>{userPosition && <Marker position={userPosition} icon={userIcon}><Popup><strong>Your current location</strong><br/>Shown only in this browser.</Popup></Marker>}{selectedPath && selectedPath.length > 1 && <Polyline positions={selectedPath} pathOptions={{ color: colours[selectedRecord!.mode], weight: 5, opacity: .8 }}/>} {records.filter(record => record.position).map(record => <Marker key={record.id} position={record.position!} icon={record.recordKind === "vehicle" ? vehicleIcon(record.mode, colours[record.mode]) : stopIcon(colours[record.mode])} eventHandlers={{ click: () => onSelect(record) }}><Popup><strong>{record.name}</strong><br/>{record.recordKind === "vehicle" ? "Vehicle" : "Station / stop"}: {record.route ?? record.station}<br/>{record.dataMode}{record.recordKind === "vehicle" && record.routePath?.length ? <><br/>GTFS route shape shown</> : null}{record.recordKind === "stop" ? <><br/>Next scheduled: {record.nextScheduledAt ? new Intl.DateTimeFormat("en-MY", { timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(record.nextScheduledAt)) : "Unavailable"}</> : null}</Popup></Marker>)}</MapContainer><div className="map-legend" aria-label="Map legend"><span><b className="legend-vehicle">🚌</b> Bus / train</span><span><b className="user-dot">●</b> Your location</span><span><b className="legend-stop">●</b> Station / stop</span>{Object.entries(colours).map(([label, colour]) => <span key={label}><i style={{ background: colour }}/>{label}</span>)}</div></section>;
}
