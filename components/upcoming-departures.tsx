"use client";
import { useEffect, useState } from "react";
import type { Record as TransitRecord } from "@/lib/transit-data";
import type { ScheduledDeparture, FrequencyWindow } from "@/lib/scheduled-departures";
type Payload = { status: string; message: string; departures: ScheduledDeparture[]; frequencies: FrequencyWindow[]; retrievedAt: string; liveEta: { available: boolean; reason: string }; sources: {source:string;lastUpdated:string|null;error:string|null}[] };
const time = (value: string) => new Intl.DateTimeFormat("en-MY", { timeZone: "Asia/Kuala_Lumpur", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(value));
export default function UpcomingDepartures({ record }: { record: TransitRecord }) {
  const [data, setData] = useState<Payload | null>(null), [error, setError] = useState(""), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(false);
  const refs = (record.stopRefs ?? []).join("|");
  useEffect(() => {
    setData(null); setError("");
    if (!refs) { setLoading(false); setError("UNAVAILABLE — no official GTFS stop reference is available for this record."); return; }
    const controller = new AbortController(); let active = true; setLoading(true); const timer = setTimeout(() => controller.abort(), 25000);
    const query = new URLSearchParams(); refs.split("|").forEach(ref => query.append("stop", ref));
    fetch(`/api/departures?${query}`, { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error(); const next = await response.json(); if (active) setData(next); }).catch(() => {if(active)setError("UNAVAILABLE — official timetable request failed. Please refresh.");}).finally(() => {clearTimeout(timer); if(active)setLoading(false);});
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [refs, refresh]);
  return <section className="departures-section" aria-label="Upcoming Departures"><h3>Upcoming Departures</h3><button className="secondary" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh departures</button>
    {loading && <p role="status">Loading official timetable…</p>}{error && <p role="status">{error}</p>}
    {data && <><p><strong>{data.status}</strong> — {data.message}</p>
      {data.departures.length > 0 && <table className="departures-table"><thead><tr><th>Line / Destination</th><th>Scheduled (MYT)</th></tr></thead><tbody>{data.departures.map(item => <tr key={`${item.source}:${item.tripId}:${item.scheduledTimestamp}`}><td>{item.routeName}<br/>{item.destination || "Destination unavailable"}<small>Route {item.routeId} · Direction {item.direction ?? "unavailable"} · Stop/platform {item.platform ?? "unavailable"}</small><small><a href={item.source} target="_blank" rel="noreferrer">Official GTFS source</a> · Updated {time(item.lastUpdated)}</small></td><td>{time(item.scheduledDeparture)}<small>SCHEDULED</small></td></tr>)}</tbody></table>}
      {data.frequencies.map((item, i) => <p key={`${item.tripId}:${item.start}:${i}`}><strong>{item.routeName}</strong> — {item.destination}<br/>SCHEDULED frequency: every {Math.round(item.headwaySeconds / 60 * 10) / 10} min<br/>{time(item.start)}–{time(item.end)} MYT<br/><small>{item.mode} · Direction {item.direction ?? "unavailable"} · Stop/platform {item.platform ?? "unavailable"}<br/>Exact departure time unavailable. <a href={item.source} target="_blank" rel="noreferrer">Official GTFS</a></small></p>)}
      <p><small>LIVE ETA: UNAVAILABLE — {data.liveEta.reason}</small></p><p><small>Retrieved {time(data.retrievedAt)} MYT</small></p>{data.sources.map(source=><p key={source.source}><small>{source.source} · Last successful refresh: {source.lastUpdated ? time(source.lastUpdated) : "Unavailable"} MYT{source.error ? ` · ${source.error}` : ""}</small></p>)}</>}
  </section>;
}
