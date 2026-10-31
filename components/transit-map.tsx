"use client";
import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import type { Record } from "@/lib/transit-data";

const colours: globalThis.Record<string, string> = { Bus: "#2563eb", MRT: "#7c3aed", LRT: "#ea580c", Monorail: "#db2777", KTM: "#0891b2", "Shared bike": "#16a34a" };
function Reset({ signal }: { signal: number }) { const map = useMap(); if (signal) map.setView([3.142, 101.699], 13); return null; }
export default function TransitMap({ records, selected, onSelect, resetSignal }: { records: Record[]; selected: string | null; onSelect: (r: Record) => void; resetSignal: number }) {
  return <section className="map-wrap" aria-label="Interactive transport map"><MapContainer center={[3.142, 101.699]} zoom={13} scrollWheelZoom className="map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><Reset signal={resetSignal}/>{records.filter(r => r.position).map(r => <CircleMarker key={r.id} center={r.position!} radius={selected === r.id ? 11 : 8} pathOptions={{ color: colours[r.mode], fillColor: colours[r.mode], fillOpacity: .9 }} eventHandlers={{ click: () => onSelect(r) }}><Popup><strong>{r.name}</strong><br />{r.route ?? r.station}<br />{r.dataMode}</Popup></CircleMarker>)}</MapContainer><div className="map-legend" aria-label="Map legend">{Object.entries(colours).map(([label, colour]) => <span key={label}><i style={{background: colour}} />{label}</span>)}</div></section>;
}
