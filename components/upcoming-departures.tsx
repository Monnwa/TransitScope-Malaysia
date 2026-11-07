"use client";
import "@/app/departure-board.css";
import { useEffect, useId, useRef, useState } from "react";
import type { Record as TransitRecord } from "@/lib/transit-data";
import TrainArrivalRows from "./train-arrival-rows";
import { frequencyKey, isArrivalMode } from "@/lib/train-arrivals";
import type { ScheduledDeparture } from "@/lib/scheduled-departures";
import { rapidRailMeta } from "@/lib/rail-model";
import { availableDepartures, boardDate, boardTime, emptyBoardMessage, malaysiaDay, safeTimetableSource, type DeparturePayload } from "@/lib/departure-board";

const normaliseLine = (name: string) => name.toLowerCase().replace(/\b(mrt[12]?|lrt|line|kl)\b/g, "").replace(/[^a-z0-9]/g, "");
const lineColour = (id: string, mode: string, name = "") => rapidRailMeta[id]?.colour ?? Object.values(rapidRailMeta).find(line => normaliseLine(line.name) === normaliseLine(name) || line.id === id)?.colour ?? (mode === "KTM" || id.startsWith("KTM:") ? "#24558A" : mode === "Bus" ? "#2563eb" : "#1666d8");
const destination = (value?: string) => value ? /^from\s+.+?\s+to\s+(.+)$/i.exec(value)?.[1] ?? value : "Destination not provided";
const stamp = (value: string) => `${boardDate(value)}, ${boardTime(value)} MYT`;

// Keying the inner board clears the previous station before the next frame and
// aborts its request, while keeping refresh results in the current board.
export default function UpcomingDepartures({ record }: { record: TransitRecord }) {
  return <StationBoard key={`${record.id}:${(record.stopRefs ?? []).join("|")}`} record={record}/>;
}
function StationBoard({ record }: { record: TransitRecord }) {
  const [data, setData] = useState<DeparturePayload | null>(null), [error, setError] = useState("");
  const [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0), [expanded, setExpanded] = useState(false), [frequencyExpanded, setFrequencyExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  const requestActive = useRef(false), lastManualRefresh = useRef(0), lastRequest = useRef(0); const listId = useId();
  const refs = (record.stopRefs ?? []).join("|");
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!refs) { setLoading(false); setError("Scheduled departure information is currently unavailable. No official stop reference was provided."); return; }
    const controller = new AbortController(); let active = true; requestActive.current = true; lastRequest.current = Date.now(); setLoading(true); setError("");
    const timer = setTimeout(() => controller.abort(), 25000); const query = new URLSearchParams(); refs.split("|").forEach(ref => query.append("stop", ref));
    fetch(`/api/departures?${query}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error(); const next = await response.json() as DeparturePayload;
      if (!Array.isArray(next.departures) || !Array.isArray(next.frequencies)) throw new Error();
      if (active) { setData(next); setNow(Date.now()); }
    }).catch(() => { if (active) setError("Could not refresh scheduled services. Please retry. Previously retrieved information is retained."); })
      .finally(() => { clearTimeout(timer); if (active) { requestActive.current = false; setLoading(false); } });
    return () => { active = false; controller.abort(); clearTimeout(timer); requestActive.current = false; };
  }, [refs, refresh]);
  const reload = () => { if (requestActive.current || Date.now() - lastManualRefresh.current < 1000) return; lastManualRefresh.current = Date.now(); requestActive.current = true; setLoading(true); setRefresh(value => value + 1); };
  const trainDisplay = (record.modes ?? [record.mode]).some(isArrivalMode) && data?.trainArrivals !== undefined;
  useEffect(() => { if (trainDisplay && data && now-lastRequest.current >= 60000 && !requestActive.current) { lastRequest.current=now; setRefresh(value=>value+1); } }, [now, trainDisplay, data]);
  const arrivals = (data?.trainArrivals ?? []).filter(item=>item.arrivalTimestamp>=now).sort((a,b)=>a.arrivalTimestamp-b.arrivalTimestamp).slice(0,10);
  const departures = availableDepartures(data?.departures ?? [], now).filter(item=>!(trainDisplay && isArrivalMode(item.mode) && arrivals.some(arrival=>arrival.source===item.source&&arrival.routeId===item.routeId)));
  const frequencies = (data?.frequencies ?? []).filter(item => Number.isFinite(Date.parse(item.end)) && Date.parse(item.end) > now && !(trainDisplay && data?.arrivalFrequencyCoverage?.includes(frequencyKey(item.source,item.tripId,item.platform,item.start,item.end))));
  const verifiedPredictions = data?.liveEta.available ? (data.liveEta.predictions ?? []).filter(item => item.verified && safeTimetableSource(item.source) && Date.parse(item.estimatedDeparture) >= now) : [];
  const noService = data && (data.emptyReason === "NO_SERVICE_TODAY" || data.emptyReason === "NO_MORE_TODAY" || data.emptyReason === undefined && /^No (?:more scheduled departures|scheduled service) (?:for )?today\./.test(data.message));
  const status = verifiedPredictions.length ? "LIVE ETA AVAILABLE" : noService ? "NO UPCOMING SERVICE" : arrivals.length ? arrivals.some(item=>item.classification==="ESTIMATED") ? "ESTIMATED ARRIVALS" : "SCHEDULED ARRIVALS" : departures.length ? "SCHEDULED SERVICE" : frequencies.length ? "FREQUENCY INFORMATION" : data?.status === "SCHEDULED" ? "NO UPCOMING SERVICE" : "TIMETABLE UNAVAILABLE";
  const visible = departures.slice(0, expanded ? 10 : 5);
  const groups = [...new Map(departures.map(item => [`${item.source}:${item.routeId}`, { key: `${item.source}:${item.routeId}`, name: item.routeName, id: item.routeId, mode: item.mode }])).values()];
  const frequencyGroups = [...new Map(frequencies.map(item => [`${item.source}:${item.routeName}`, { key: `${item.source}:${item.routeName}`, name: item.routeName, mode: item.mode }])).values()];
  const names = record.lineNames?.length ? record.lineNames : record.route ? [record.route] : [];
  const stopCodes = [...new Set((record.stopRefs ?? []).map(ref => ref.slice(ref.indexOf(":") + 1)))];
  const renderDeparture = (item: ScheduledDeparture) => <li className="board-departure" key={`${item.source}:${item.tripId}:${item.scheduledDeparture}`} style={{ borderLeftColor: lineColour(item.routeId, item.mode) }}>
    <div className="board-service"><strong className="board-route">{item.mode === "Bus" ? `Bus ${/^[a-z]*\d+[a-z]?$/i.test(item.routeName) ? item.routeName : item.routeId}` : item.routeName}</strong>{item.mode === "Bus" && item.routeName !== item.routeId && !/^[a-z]*\d+[a-z]?$/i.test(item.routeName) && <span className="board-route-name">{item.routeName}</span>}<span className="board-destination">{item.destination ? "Towards " : ""}{destination(item.destination)}</span><span className="board-service-meta">{item.direction !== undefined && `Direction ${item.direction}`}{item.direction !== undefined && item.platform ? " · " : ""}{item.platform ? `Stop / platform ${item.platform}` : ""}</span></div>
    <div className="board-time"><time dateTime={item.scheduledDeparture}>{boardTime(item.scheduledDeparture)}</time>{malaysiaDay(item.scheduledDeparture) !== malaysiaDay(now) && <span className="board-date">{boardDate(item.scheduledDeparture)}</span>}<span className="board-type">SCHEDULED</span></div>
  </li>;
  const notice = data ? noService ? emptyBoardMessage(data) : !departures.length && !arrivals.length && !frequencies.length ? data.status === "SCHEDULED" ? "No more scheduled departures today." : emptyBoardMessage(data) : "" : "";
  const displayNotice = trainDisplay ? notice === "No more scheduled departures today." ? "No more trains today." : notice === "No scheduled service for today." ? "No service today." : notice : notice;
  return <section className="station-departure-board" aria-label="Station departure board">
    <div className="board-station-header"><p className="board-eyebrow">{record.mode === "Bus" ? "BUS STOP" : "STATION DEPARTURE BOARD"}</p><h2>{record.name}</h2><p className="board-station-meta">{(record.modes?.length ? record.modes : [record.mode]).join(" / ")}{record.mode === "Bus" ? ` Stop · ${record.operator}` : " Station"}{record.interchange ? " · Interchange" : ""}</p>
      <div className="board-line-list" aria-label="Station lines">{names.map((name, index) => <span className="board-line-chip" key={name} style={{ borderLeftColor: lineColour(record.railLines?.[index] ?? record.routeId ?? "", record.mode, name) }}>{name}</span>)}</div>
      {stopCodes.length > 0 && <p className="board-stop-codes">GTFS stop {stopCodes.length === 1 ? "code" : "codes"}: {stopCodes.join(" / ")}</p>}
      <span className={`board-status ${verifiedPredictions.length ? "board-status-live" : ""}`} aria-label="Departure service status">{loading && !data ? "Loading scheduled services" : status}</span>
    </div>
    <section className="board-upcoming" aria-label="Upcoming Departures" aria-busy={loading}>
      <div className="board-section-heading"><h3>{record.mode === "Bus" ? "Upcoming Buses" : trainDisplay ? "Upcoming Trains" : "Upcoming Departures"}</h3><button type="button" className="board-refresh" aria-label="Refresh departures" disabled={loading} onClick={reload}>{loading ? "Refreshing…" : "↻ Refresh"}</button></div>
      <div className="board-announcement" role="status" aria-live="polite">{loading ? data ? "Refreshing scheduled services…" : "Loading scheduled services…" : data ? `Updated ${boardTime(data.retrievedAt)} MYT. ${trainDisplay ? `${arrivals.length} upcoming train arrivals available.` : `${departures.length} scheduled departures available.`}${frequencies.length ? " Published frequency information available." : ""}` : ""}</div>
      {error && <p className="board-error" role="alert">{error} <button type="button" className="board-text-button" disabled={loading} onClick={reload}>Retry</button></p>}
      {displayNotice && <p className="board-empty" role="status">{displayNotice}</p>}
      {arrivals.length>0 && <TrainArrivalRows arrivals={arrivals} now={now}/>}
      {trainDisplay && departures.length>0 && <h4 className="board-retained-departures">Scheduled departures</h4>}
      {departures.length > 0 && <div id={listId} className="board-departure-list">{groups.map(group => {
        const services = visible.filter(item => `${item.source}:${item.routeId}` === group.key);
        return <div className="board-line-group" key={group.key}>{groups.length > 1 && <h4 style={{ borderLeftColor: lineColour(group.id, group.mode) }}>{group.name}</h4>}<ul aria-label={groups.length > 1 ? `${group.name} scheduled departures` : "Scheduled departures"}>{services.map(renderDeparture)}</ul>{services.length === 0 && <p className="board-more-line">More services in the expanded list.</p>}</div>;
      })}</div>}
      {departures.length > 5 && <button type="button" className="board-expand" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}>{expanded ? "Show less" : "Show all departures"}{!expanded && <span> ({departures.length})</span>}</button>}
      {data && frequencies.length > 0 && <section className="board-frequency" aria-label="Service Frequency"><div className="board-section-heading"><h3>Service Frequency</h3><span className="board-type">FREQUENCY</span></div><p className="board-frequency-caption">Published service headway · exact departure times are unavailable.</p>{frequencyGroups.map(group => <div className="board-frequency-group" key={group.key}><h4 style={{ borderLeftColor: lineColour("", group.mode, group.name) }}>{group.name}</h4>{frequencies.filter(item => `${item.source}:${item.routeName}` === group.key).slice(0, frequencyExpanded ? 10 : 2).map((item, index) => <div className="board-frequency-window" key={`${item.tripId}:${item.start}:${index}`}><div><span className="board-destination">{item.destination ? "Towards " : ""}{destination(item.destination)}</span><span className="board-service-meta">{item.direction !== undefined ? `Direction ${item.direction}` : ""}{item.platform ? ` · Stop / platform ${item.platform}` : ""}</span></div><strong className="board-headway">Every {Math.round(item.headwaySeconds / 60 * 10) / 10} min</strong><p className="board-operating-hours">{boardDate(item.start)} · <time dateTime={item.start}>{boardTime(item.start)}</time>–<time dateTime={item.end}>{boardTime(item.end)}</time>{malaysiaDay(item.end) !== malaysiaDay(item.start) ? ` (${boardDate(item.end)})` : ""} MYT</p></div>)}</div>)}{frequencyGroups.some(group => frequencies.filter(item => `${item.source}:${item.routeName}` === group.key).length > 2) && <button type="button" className="board-expand" aria-expanded={frequencyExpanded} onClick={() => setFrequencyExpanded(value => !value)}>{frequencyExpanded ? "Show fewer frequency periods" : "Show all frequency periods"}</button>}</section>}
      {verifiedPredictions.length > 0 && <section className="board-live-estimates" aria-label="Live estimates"><h3>LIVE ETA</h3>{verifiedPredictions.map(item => <p key={item.tripId}>Trip {item.tripId} · Estimated <time dateTime={item.estimatedDeparture}>{boardTime(item.estimatedDeparture)}</time></p>)}</section>}
      <footer className="board-data-footer"><p>{verifiedPredictions.length ? "Verified real-time estimates are displayed separately." : "LIVE ETA: UNAVAILABLE"}</p><p>Scheduled and estimated information is not real-time arrival information.</p>{data && <><p className="board-updated">Last retrieved <time dateTime={data.retrievedAt}>{stamp(data.retrievedAt)}</time>{error ? " · Refresh failed" : ""}</p><details className="board-sources"><summary>Timetable sources &amp; status</summary>{[...new Set([...data.departures.map(item => item.source), ...data.frequencies.map(item => item.source), ...(data.trainArrivals ?? []).map(item=>item.source)])].map(source => <p key={source}>{safeTimetableSource(source) ? <a href={source} target="_blank" rel="noreferrer">Official timetable source</a> : "Timetable source unavailable"}</p>)}{data.sources.map(source => <p key={source.source}>{source.source}<br/>Last successful refresh: {source.lastUpdated ? stamp(source.lastUpdated) : "Unavailable"}{source.error ? ` · ${source.error}` : ""}</p>)}</details></>}</footer>
    </section>
  </section>;
}
